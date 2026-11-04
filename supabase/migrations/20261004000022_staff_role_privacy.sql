-- ============================================================================
-- Migration: 20261004000022_staff_role_privacy.sql
-- Description: Constitution Principle 8 (Strict Role Privacy). Staff must
--              never be able to read wholesale costs, supplier margins or
--              purchase/expense ledger rows, even with a raw client token:
--   1. Column-level SELECT privileges hide inventory.last_purchase_price from
--      authenticated clients; owners/admins read it through the secure view.
--   2. public.staff_inventory is the member-scoped, cost-masked inventory view
--      (owners and admins see real costs, staff see NULL).
--   3. events RLS blocks PURCHASED and EXPENSE rows for the staff role while
--      owners/admins keep full ledger history.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Secure, cost-masked inventory view (owner/admin keep real costs)
-- ----------------------------------------------------------------------------
create or replace view public.staff_inventory
with (security_invoker = false)
as
select
    i.id,
    i.user_id,
    i.store_id,
    i.product_id,
    i.name,
    i.quantity,
    i.unit,
    i.barcode,
    case
        when i.store_id is null then i.last_purchase_price
        when public.is_store_owner_admin(i.store_id) then i.last_purchase_price
        else null
    end as last_purchase_price,
    i.selling_price,
    i.low_stock_threshold,
    i.base_unit,
    i.secondary_unit,
    i.conversion_factor,
    i.category,
    i.aliases,
    i.created_at,
    i.updated_at
from public.inventory i
where (i.store_id is not null and public.is_store_member(i.store_id))
   or (i.store_id is null and i.user_id = auth.uid());

revoke all on public.staff_inventory from public, anon;
grant select on public.staff_inventory to authenticated;
grant select on public.staff_inventory to service_role;

-- ----------------------------------------------------------------------------
-- 2. Base table: authenticated clients may read every inventory column except
--    the wholesale cost. Owner/admin paths read staff_inventory instead.
-- ----------------------------------------------------------------------------
revoke select on public.inventory from authenticated;
grant select (
    id,
    user_id,
    store_id,
    product_id,
    name,
    quantity,
    unit,
    barcode,
    selling_price,
    low_stock_threshold,
    base_unit,
    secondary_unit,
    conversion_factor,
    category,
    aliases,
    created_at,
    updated_at
) on public.inventory to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Ledger rows carrying cost detail are invisible to staff
-- ----------------------------------------------------------------------------
drop policy if exists "events_store_members_select" on public.events;
create policy "events_store_members_select" on public.events
    for select to authenticated
    using (
        store_id is not null
        and public.is_store_member(store_id)
        and (
            public.is_store_owner_admin(store_id)
            or type not in ('PURCHASED', 'EXPENSE')
        )
    );

notify pgrst, 'reload schema';
