-- ============================================================================
-- Migration: 20261004000026_unit_and_write_hardening.sql
-- Description: Third-pass audit fixes:
--   1. convert_to_base_unit: a SKU's custom pack factor applies ONLY to the
--      SKU's own secondary unit (exact code or an alias of the same registry
--      row) — never to any unit of the same dimension (1 dozen ≠ 1 peti).
--   2. Actor deletion: pin_inventory_attribution / prevent_events_mutation no
--      longer block the FK's `user_id -> NULL` update, so the ON DELETE SET
--      NULL design from 018 actually works.
--   3. classify_product_category: "pav" only matches as a whole word, so
--      "Pav Bhaji Masala" is not classified as DAIRY_BAKERY.
--   4. Owner-only wholesale cost writes: authenticated clients can no longer
--      UPDATE inventory.last_purchase_price directly; owners/admins go through
--      set_product_cost().
--   5. RPC grants for the invite functions and removal of four redundant
--      indexes.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Pack-break conversion only for the SKU's own secondary unit
-- ----------------------------------------------------------------------------
create or replace function public.convert_to_base_unit(
    p_qty numeric,
    p_input_unit text,
    p_base_unit text default null,
    p_secondary_unit text default null,
    p_custom_factor numeric default null
)
returns numeric
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
    v_unit text := nullif(lower(trim(p_input_unit)), '');
    v_base text := nullif(lower(trim(p_base_unit)), '');
    v_secondary text := nullif(lower(trim(p_secondary_unit)), '');
    v_registry_base text;
    v_factor numeric;
begin
    if p_qty is null or v_unit is null then
        return p_qty;
    end if;

    if v_base is not null and v_unit = v_base then
        return p_qty;
    end if;

    -- SKU custom secondary packaging conversion (e.g. bori, peti, box).
    -- Only the secondary unit itself (exact code or an alias of the SAME
    -- registry row) may use the SKU factor; same-dimension units such as
    -- katta/dozen must use their own registry factors instead.
    if v_secondary is not null and p_custom_factor is not null and p_custom_factor > 0 then
        if v_unit = v_secondary
           or exists (
               select 1 from public.unit_registry r
               where (lower(r.code) = v_secondary or exists (select 1 from unnest(r.aliases) a where lower(a) = v_secondary))
                 and (lower(r.code) = v_unit or exists (select 1 from unnest(r.aliases) a where lower(a) = v_unit))
           ) then
            return p_qty * p_custom_factor;
        end if;
    end if;

    select r.conversion_factor, r.base_unit
      into v_factor, v_registry_base
      from public.unit_registry r
     where lower(r.code) = v_unit
        or exists (
            select 1 from unnest(r.aliases) a
            where lower(a) = v_unit
        )
     limit 1;

    if v_factor is null then
        return p_qty;
    end if;

    -- Never convert across dimensions without an explicit SKU density
    if v_base is not null and v_registry_base <> v_base then
        return p_qty;
    end if;

    return p_qty * v_factor;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Allow the FK's user_id -> NULL update (account deletion) but nothing else
-- ----------------------------------------------------------------------------
create or replace function public.pin_inventory_attribution()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
    -- Only the ON DELETE SET NULL cascade may clear the actor.
    if new.user_id is not null then
        new.user_id := old.user_id;
    end if;
    return new;
end;
$$;

create or replace function public.prevent_events_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    -- Permit only the FK's user_id -> NULL update; everything else is denied.
    if new.user_id is null
       and (to_jsonb(new) - 'user_id') = (to_jsonb(old) - 'user_id') then
        return new;
    end if;
    raise exception 'Ledger is append-only';
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. "pav" must be a whole word (Pav Bhaji Masala is not bakery)
-- ----------------------------------------------------------------------------
create or replace function public.classify_product_category(
    p_name text,
    p_unit text default null
)
returns text
language plpgsql
immutable
security invoker
as $$
declare
    v_norm text := lower(coalesce(trim(p_name), ''));
    v_unit text := lower(coalesce(trim(p_unit), ''));
begin
    -- "pav bhaji masala" is a spice blend, not bakery: never let the standalone
    -- word "pav" drag it into DAIRY_BAKERY.
    if v_norm ~* 'pav\s+bhaji' then
        return 'STAPLES';
    end if;

    -- 1. Packaged FMCG (12% margin) — checked first so packaged items with
    -- dairy/staple flavors (Butter Cookies, Milk Biscuits) stay FMCG.
    if v_norm ~* '(maggi|biscuit|biscuits|cookie|cookies|parle|good day|marie|chips|lays|kurkure|soap|sabun|shampoo|paste|toothpaste|colgate|close up|noodle|noodles|chai|tea|patti|coffee|namkeen|bhujia|sev|chocolate|cadbury|dairy milk|kitkat|detergent|surf|rin|tide|ariel|vim|harpic|dove|lux|dettol|oreo|marigold)' then
        return 'FMCG';
    end if;

    -- 2. Dairy & Bakery (8% margin)
    if v_norm ~* '(milk|doodh|dudh|bread|\mpav\M|dahi|curd|paneer|butter|makkhan|makhan|egg|anda|ande|lassi|chaas|buttermilk|bun|rusk|rusks|amul|mother dairy|nandini|harvest gold|britannia bread|modern|english oven|bakery)' then
        return 'DAIRY_BAKERY';
    end if;

    -- 3. Staples & Loose Commodities (6% margin)
    if v_norm ~* '(sugar|cheeni|chini|rice|chawal|atta|aata|flour|maida|sooji|suji|besan|dal|daal|toor|arhar|moong|chana|urad|masoor|oil|tel|sarson|mustard|jeera|cumin|haldi|turmeric|mirch|chilli|namak|salt|ghee|hing|dhaniya|poha|wheat|pulse|pulses)'
       or v_unit in ('kg', 'g', 'gram', 'grams', 'l', 'ml', 'litre', 'liter', 'litres', 'liters') then
        return 'STAPLES';
    end if;

    -- 4. Default Store Benchmark (10% margin)
    return 'GENERAL';
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Wholesale costs are owner/admin-writable only
-- ----------------------------------------------------------------------------
-- Table-level UPDATE would override any column revoke, so grant the safe
-- columns explicitly and route cost edits through set_product_cost().
revoke update on public.inventory from authenticated;
grant update (
    product_id,
    name,
    unit,
    barcode,
    selling_price,
    low_stock_threshold,
    base_unit,
    secondary_unit,
    conversion_factor,
    category,
    aliases
) on public.inventory to authenticated;

create or replace function public.set_product_cost(
    p_item_id uuid,
    p_cost numeric
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_item public.inventory%rowtype;
begin
    if auth.uid() is null then
        raise exception 'not authenticated';
    end if;
    if p_cost is not null and p_cost < 0 then
        raise exception 'cost must be greater than or equal to zero';
    end if;

    select * into v_item
      from public.inventory
     where id = p_item_id
     for update;

    if not found then
        return false;
    end if;

    if v_item.store_id is not null then
        if not public.is_store_owner_admin(v_item.store_id) then
            raise exception 'not authorized';
        end if;
    elsif v_item.user_id is distinct from auth.uid() then
        raise exception 'not authorized';
    end if;

    update public.inventory
       set last_purchase_price = p_cost,
           updated_at = now()
     where id = p_item_id;

    return true;
end;
$$;

revoke all on function public.set_product_cost(uuid, numeric) from public, anon;
grant execute on function public.set_product_cost(uuid, numeric) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Invite RPC grants (defense-in-depth; anon must never execute them)
-- ----------------------------------------------------------------------------
revoke all on function public.join_store_by_invite_code(text, text) from public, anon;
grant execute on function public.join_store_by_invite_code(text, text) to authenticated;

revoke all on function public.generate_store_invite_code(uuid) from public, anon;
grant execute on function public.generate_store_invite_code(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. Drop indexes covered by unique constraints
-- ----------------------------------------------------------------------------
drop index if exists public.idx_stores_invite_code;
drop index if exists public.idx_store_members_store_id;
drop index if exists public.idx_inventory_store_id;
drop index if exists public.idx_events_store_id;

-- ----------------------------------------------------------------------------
-- 7. Registry data gap: "jholi" (झोली) is a common kirana carry-bag term; add
--    it to the existing theli (bag) row so voice parsing resolves it.
-- ----------------------------------------------------------------------------
update public.unit_registry
   set aliases = array_append(aliases, 'jholi')
 where code = 'theli'
   and not (aliases @> array['jholi']);

notify pgrst, 'reload schema';
