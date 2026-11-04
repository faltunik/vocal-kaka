-- ============================================================================
-- Migration: 20261004000023_invite_code_expiry.sql
-- Description: FEAT-07 — staff may only join with a valid, unexpired invite
--              code. Adds stores.invite_expires_at (24h TTL), backfills any
--              existing codes, and enforces expiry in both RPCs.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Expiry column + backfill (existing codes stay valid for 24h from deploy)
-- ----------------------------------------------------------------------------
alter table public.stores
    add column if not exists invite_expires_at timestamptz;

update public.stores
   set invite_expires_at = now() + interval '24 hours'
 where invite_code is not null
   and invite_expires_at is null;

-- ----------------------------------------------------------------------------
-- 2. Rotation always issues a fresh 24h TTL (owner-only auth from 017)
-- ----------------------------------------------------------------------------
create or replace function public.generate_store_invite_code(p_store_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    v_code text;
    v_exists boolean;
    v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    v_len int := 6;
    v_attempts int := 0;
begin
    if not exists (
        select 1 from public.stores
        where id = p_store_id and owner_id = auth.uid()
    ) then
        raise exception 'not authorized to rotate this store invite code';
    end if;

    loop
        v_code := '';
        for i in 1..v_len loop
            v_code := v_code || substr(v_chars, floor(random() * length(v_chars) + 1)::int, 1);
        end loop;

        v_code := 'KAKA' || substr(v_code, 1, 4);

        select exists (select 1 from public.stores where invite_code = v_code and id <> p_store_id)
        into v_exists;

        exit when not v_exists or v_attempts > 20;
        v_attempts := v_attempts + 1;
    end loop;

    update public.stores
    set invite_code = v_code,
        invite_expires_at = now() + interval '24 hours',
        updated_at = now()
    where id = p_store_id;

    return v_code;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Joining rejects expired (or TTL-less) codes
-- ----------------------------------------------------------------------------
create or replace function public.join_store_by_invite_code(
    p_invite_code text,
    p_display_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_caller_id uuid;
    v_store record;
    v_existing_role text;
begin
    v_caller_id := auth.uid();
    if v_caller_id is null then
        raise exception 'Authentication required to join store';
    end if;

    -- Lookup store by invite code (case-insensitive)
    select * into v_store
    from public.stores
    where upper(trim(invite_code)) = upper(trim(p_invite_code));

    if not found then
        return jsonb_build_object('success', false, 'error', 'Invalid store invite code');
    end if;

    -- Check if caller is already a member (existing members are unaffected by
    -- expiry: their access was granted while the code was valid).
    select role into v_existing_role
    from public.store_members
    where store_id = v_store.id and user_id = v_caller_id;

    if found then
        return jsonb_build_object(
            'success', true,
            'message', 'Already a member',
            'store_id', v_store.id,
            'store_name', v_store.name,
            'role', v_existing_role
        );
    end if;

    if v_store.invite_expires_at is null or v_store.invite_expires_at < now() then
        return jsonb_build_object('success', false, 'error', 'Store invite code has expired');
    end if;

    -- Insert membership as staff
    insert into public.store_members (store_id, user_id, role, display_name)
    values (v_store.id, v_caller_id, 'staff', coalesce(trim(p_display_name), 'Staff'));

    return jsonb_build_object(
        'success', true,
        'message', 'Joined store successfully',
        'store_id', v_store.id,
        'store_name', v_store.name,
        'role', 'staff'
    );
end;
$$;

notify pgrst, 'reload schema';
