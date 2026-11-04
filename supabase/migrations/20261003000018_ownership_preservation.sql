-- ============================================================================
-- Migration: 20261003000018_ownership_preservation.sql
-- Description: Shared store data must survive the deletion of a member
--              account, and correcting/voiding must stay safe once actor
--              attribution is null:
--   1. inventory.user_id / events.user_id → ON DELETE SET NULL (nullable).
--      `user_id` stays the acting user (audit + per-actor idempotency), while
--      shared visibility is governed by store_id + RLS.
--   2. stores.owner_id → ON DELETE RESTRICT so deleting an owner account can
--      never silently cascade-wipe a store that staff still use.
--   3. Null-safe authorization in apply_correction / resolve_unpriced_sale
--      (`IS DISTINCT FROM` instead of `<>`, which is NULL-tolerant and would
--      otherwise authorize orphaned events).
--   4. Null-safe legacy void correlation in active_events.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Preserve shared inventory and ledger rows when the acting account is deleted
-- ----------------------------------------------------------------------------
alter table public.inventory alter column user_id drop not null;
alter table public.inventory drop constraint if exists inventory_user_id_fkey;
alter table public.inventory add constraint inventory_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete set null;

alter table public.events alter column user_id drop not null;
alter table public.events drop constraint if exists events_user_id_fkey;
alter table public.events add constraint events_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete set null;

-- ----------------------------------------------------------------------------
-- 2. Never cascade-wipe a shared store when its owner account is deleted.
--    Ownership must be transferred or the store deleted explicitly first.
-- ----------------------------------------------------------------------------
alter table public.stores drop constraint if exists stores_owner_id_fkey;
alter table public.stores add constraint stores_owner_id_fkey
    foreign key (owner_id) references auth.users(id) on delete restrict;

-- ----------------------------------------------------------------------------
-- 3. Null-safe atomic corrections
-- ----------------------------------------------------------------------------
create or replace function public.apply_correction(
    p_voided_event_id uuid,
    p_replacement_type text,
    p_replacement_payload jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    uid uuid := auth.uid();
    v_event public.events%rowtype;
    v_inserted int;
begin
    if uid is null then
        raise exception 'not authenticated';
    end if;

    select * into v_event
      from public.events
     where event_id = p_voided_event_id
     for update;

    if not found then
        raise exception 'event not found';
    end if;

    if v_event.store_id is not null then
        if not exists (
            select 1 from public.store_members
            where store_id = v_event.store_id and user_id = uid
        ) then
            raise exception 'event not found';
        end if;
    elsif v_event.user_id is distinct from uid then
        -- NULL user_id (deleted actor) can never be corrected again
        raise exception 'event not found';
    end if;

    -- Idempotent replay: if this event was already corrected in this tenant,
    -- report success without applying a second reversal or replacement.
    if exists (
        select 1 from public.events v
        where v.type = 'VOID'
          and v.payload->>'voided_event_id' = p_voided_event_id::text
          and (
                (v_event.store_id is not null and v.store_id = v_event.store_id)
                or (v_event.store_id is null and v.store_id is null and v.user_id is not distinct from v_event.user_id)
              )
    ) then
        return true;
    end if;

    with inserted as (
        insert into public.events (user_id, store_id, type, payload, ledger_event_id)
        values (
            uid,
            v_event.store_id,
            'VOID',
            jsonb_build_object('voided_event_id', p_voided_event_id),
            'void-' || p_voided_event_id::text
        )
        on conflict do nothing
        returning 1
    )
    select count(*) into v_inserted from inserted;

    if v_inserted = 0 then
        -- Lost a race; the concurrent correction owns the replacement
        return true;
    end if;

    if p_replacement_type is not null then
        insert into public.events (user_id, store_id, type, payload, ledger_event_id)
        values (
            uid,
            v_event.store_id,
            p_replacement_type,
            coalesce(p_replacement_payload, '{}'::jsonb),
            'edit-' || p_voided_event_id::text || '-' || replace(gen_random_uuid()::text, '-', '')
        );
    end if;

    return true;
end;
$$;

revoke all on function public.apply_correction(uuid, text, jsonb) from public, anon;
grant execute on function public.apply_correction(uuid, text, jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Null-safe unpriced value-sale resolution
-- ----------------------------------------------------------------------------
create or replace function public.resolve_unpriced_sale(
    p_event_id uuid,
    p_rate_per_unit numeric
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_event public.events%rowtype;
    v_amount numeric;
    v_calc_qty numeric;
    v_product text;
    v_unit text;
begin
    if p_rate_per_unit is null or p_rate_per_unit <= 0 then
        raise exception 'Rate per unit must be greater than zero';
    end if;

    -- Row lock to prevent concurrent double resolution
    select * into v_event
      from public.events
     where event_id = p_event_id
     for update;

    if not found then
        return false;
    end if;

    if v_event.store_id is not null then
        if not exists (
            select 1 from public.store_members
            where store_id = v_event.store_id and user_id = auth.uid()
        ) then
            raise exception 'not authorized';
        end if;
    elsif v_event.user_id is distinct from auth.uid() then
        return false;
    end if;

    if v_event.type <> 'SOLD' then
        raise exception 'Only SOLD events can be resolved for unpriced value sales';
    end if;

    -- Idempotency guard: If already resolved, do not deduct inventory again
    if coalesce((v_event.payload->>'pricing_unresolved')::boolean, false) is false then
        return true;
    end if;

    v_amount := coalesce(
        public.safe_numeric(v_event.payload->>'amount_spent'),
        public.safe_numeric(v_event.payload->>'amount')
    );
    v_product := nullif(trim(v_event.payload->>'product'), '');
    v_unit := coalesce(v_event.payload->>'unit', 'kg');

    if v_amount is null or v_amount <= 0 or v_product is null then
        return false;
    end if;

    v_calc_qty := round(v_amount / p_rate_per_unit, 4);

    perform public.upsert_inventory_movement(
        auth.uid(), v_product, v_unit, -v_calc_qty, p_rate_per_unit, 'SELL', null, v_event.store_id
    );

    update public.events
       set payload = payload || jsonb_build_object(
           'quantity', v_calc_qty,
           'calculated_quantity', v_calc_qty,
           'unit', v_unit,
           'unit_price_used', p_rate_per_unit,
           'price_source', 'manual_resolution',
           'pricing_unresolved', false,
           'needs_weight_review', false
       )
     where event_id = p_event_id;

    return true;
end;
$$;

revoke all on function public.resolve_unpriced_sale(uuid, numeric) from public, anon;
grant execute on function public.resolve_unpriced_sale(uuid, numeric) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. active_events: null-safe legacy void correlation
-- ----------------------------------------------------------------------------
create or replace view public.active_events
with (security_invoker = true)
as
select e.*
from public.events e
where e.type <> 'VOID'
  and not exists (
    select 1
    from public.events v
    where v.type = 'VOID'
      and v.payload->>'voided_event_id' = e.event_id::text
      and (
        (e.store_id is not null and v.store_id = e.store_id)
        or (e.store_id is null and v.store_id is null and v.user_id is not distinct from e.user_id)
      )
  );

grant select on public.active_events to authenticated;
grant select on public.active_events to service_role;

notify pgrst, 'reload schema';
