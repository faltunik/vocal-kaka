-- Migration: 20261003000015_store_management_and_sharing.sql
-- Description: Multi-Store Management, Shared Counter & Staff Access (Stores, Members, Invite Codes)

-- 1. Create stores table
CREATE TABLE IF NOT EXISTS public.stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    category TEXT DEFAULT 'GENERAL' CHECK (category IN ('GENERAL', 'FMCG', 'STAPLES', 'DAIRY_BAKERY', 'SPICES')),
    phone TEXT,
    address TEXT,
    upi_id TEXT,
    invite_code TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for owner lookups and invite codes
CREATE INDEX IF NOT EXISTS idx_stores_owner_id ON public.stores(owner_id);
CREATE INDEX IF NOT EXISTS idx_stores_invite_code ON public.stores(invite_code);

-- 2. Create store_members table
CREATE TABLE IF NOT EXISTS public.store_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('owner', 'admin', 'staff')),
    display_name TEXT,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_store_member UNIQUE (store_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_store_members_user_id ON public.store_members(user_id);
CREATE INDEX IF NOT EXISTS idx_store_members_store_id ON public.store_members(store_id);

-- 3. Add store_id to inventory and events tables for tenant isolation
ALTER TABLE public.inventory
    ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES public.stores(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_inventory_store_id ON public.inventory(store_id);

ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES public.stores(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_events_store_id ON public.events(store_id);

-- 4. Helper function to check membership without triggering RLS on store_members
-- (a policy that subqueries its own table would recurse infinitely).
CREATE OR REPLACE FUNCTION public.is_store_member(p_store_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.store_members
        WHERE store_id = p_store_id AND user_id = auth.uid()
    );
$$;

-- 5. Helper function to generate an unambiguous 6-character uppercase alphanumeric code
CREATE OR REPLACE FUNCTION public.generate_store_invite_code(p_store_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_code TEXT;
    v_exists BOOLEAN;
    v_chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- Excludes 0, O, 1, I to avoid phonetic/visual confusion
    v_len INT := 6;
    v_attempts INT := 0;
BEGIN
    LOOP
        v_code := '';
        FOR i IN 1..v_len LOOP
            v_code := v_code || substr(v_chars, floor(random() * length(v_chars) + 1)::INT, 1);
        END LOOP;
        
        -- Prefix with 'KAKA' and keep a 4-character random suffix
        v_code := 'KAKA' || substr(v_code, 1, 4);

        SELECT EXISTS (SELECT 1 FROM public.stores WHERE invite_code = v_code AND id <> p_store_id)
        INTO v_exists;

        EXIT WHEN NOT v_exists OR v_attempts > 20;
        v_attempts := v_attempts + 1;
    END LOOP;

    UPDATE public.stores
    SET invite_code = v_code, updated_at = now()
    WHERE id = p_store_id;

    RETURN v_code;
END;
$$;

-- 6. Helper function for a user to join a store via invite code
CREATE OR REPLACE FUNCTION public.join_store_by_invite_code(
    p_invite_code TEXT,
    p_display_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id UUID;
    v_store RECORD;
    v_existing_role TEXT;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required to join store';
    END IF;

    -- Lookup store by invite code (case-insensitive)
    SELECT * INTO v_store
    FROM public.stores
    WHERE upper(trim(invite_code)) = upper(trim(p_invite_code));

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid store invite code');
    END IF;

    -- Check if caller is already a member
    SELECT role INTO v_existing_role
    FROM public.store_members
    WHERE store_id = v_store.id AND user_id = v_caller_id;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'success', true,
            'message', 'Already a member',
            'store_id', v_store.id,
            'store_name', v_store.name,
            'role', v_existing_role
        );
    END IF;

    -- Insert membership as staff
    INSERT INTO public.store_members (store_id, user_id, role, display_name)
    VALUES (v_store.id, v_caller_id, 'staff', coalesce(trim(p_display_name), 'Staff'));

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Joined store successfully',
        'store_id', v_store.id,
        'store_name', v_store.name,
        'role', 'staff'
    );
END;
$$;

-- 7. Seamless Backfill for Existing Users
-- For every user with existing inventory or events, create their default store
DO $$
DECLARE
    v_user RECORD;
    v_store_id UUID;
    v_store_name TEXT;
    v_code TEXT;
BEGIN
    FOR v_user IN
        SELECT DISTINCT u.id, coalesce(u.raw_user_meta_data->>'store_name', split_part(u.email, '@', 1), 'My Kirana Store') as s_name
        FROM auth.users u
        LEFT JOIN public.stores s ON s.owner_id = u.id
        WHERE s.id IS NULL
    LOOP
        v_store_name := v_user.s_name;
        IF v_store_name IS NULL OR length(trim(v_store_name)) = 0 THEN
            v_store_name := 'My Kirana Store';
        END IF;

        -- Create default store
        INSERT INTO public.stores (name, owner_id, category)
        VALUES (v_store_name, v_user.id, 'GENERAL')
        RETURNING id INTO v_store_id;

        -- Generate invite code
        PERFORM public.generate_store_invite_code(v_store_id);

        -- Add owner as member
        INSERT INTO public.store_members (store_id, user_id, role, display_name)
        VALUES (v_store_id, v_user.id, 'owner', 'Owner')
        ON CONFLICT (store_id, user_id) DO NOTHING;

        -- Link existing inventory items
        UPDATE public.inventory
        SET store_id = v_store_id
        WHERE user_id = v_user.id AND store_id IS NULL;

        -- Link existing events
        UPDATE public.events
        SET store_id = v_store_id
        WHERE user_id = v_user.id AND store_id IS NULL;
    END LOOP;
END;
$$;

-- 8. Row Level Security Policies
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_members ENABLE ROW LEVEL SECURITY;

-- Stores: Members can view the stores they belong to
DROP POLICY IF EXISTS "Members can view their stores" ON public.stores;
CREATE POLICY "Members can view their stores" ON public.stores
    FOR SELECT
    USING (
        public.is_store_member(id)
        OR owner_id = auth.uid()
    );

-- Stores: Owners can update their stores
DROP POLICY IF EXISTS "Owners can update their stores" ON public.stores;
CREATE POLICY "Owners can update their stores" ON public.stores
    FOR UPDATE
    USING (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

-- Stores: Owners can insert new stores
DROP POLICY IF EXISTS "Users can create stores" ON public.stores;
CREATE POLICY "Users can create stores" ON public.stores
    FOR INSERT
    WITH CHECK (owner_id = auth.uid());

-- Store Members: Members can view all other members of their store
DROP POLICY IF EXISTS "Members can view store memberships" ON public.store_members;
CREATE POLICY "Members can view store memberships" ON public.store_members
    FOR SELECT
    USING (
        public.is_store_member(store_id)
    );

-- Store Members: Owners can manage (insert/update/delete) members
DROP POLICY IF EXISTS "Owners can manage memberships" ON public.store_members;
CREATE POLICY "Owners can manage memberships" ON public.store_members
    FOR ALL
    USING (
        store_id IN (SELECT id FROM public.stores WHERE owner_id = auth.uid())
    );

-- Store Members: Users can delete their own membership (leave store)
DROP POLICY IF EXISTS "Users can leave stores" ON public.store_members;
CREATE POLICY "Users can leave stores" ON public.store_members
    FOR DELETE
    USING (user_id = auth.uid() AND role <> 'owner');
