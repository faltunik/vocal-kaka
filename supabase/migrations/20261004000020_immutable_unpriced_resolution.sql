-- ============================================================================
-- Migration: 20261004000020_immutable_unpriced_resolution.sql
-- Description: The events ledger is strictly append-only (Constitution
--              Principle 2, "The Digital Bahi-Khata"):
--   1. resolve_unpriced_sale no longer executes a direct UPDATE public.events.
--      It voids the unresolved entry through apply_correction() and appends a
--      replacement SOLD event carrying the resolved quantity, rate and price
--      source, so the original audit trail survives forever.
--   2. A BEFORE UPDATE OR DELETE trigger rejects any direct ledger mutation
--      with "Ledger is append-only".
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Guard: the ledger can only grow
-- ----------------------------------------------------------------------------
create or replace function public.prevent_events_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    raise exception 'Ledger is append-only';
end;
$$;

drop trigger if exists prevent_events_mutation on public.events;
create trigger prevent_events_mutation
    before update or delete on public.events
    for each row execute function public.prevent_events_mutation();

-- ----------------------------------------------------------------------------
-- 2. Resolve unpriced value sales by correction, never by mutation
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
    v_replacement jsonb;
begin
    if p_rate_per_unit is null or p_rate_per_unit <= 0 then
        raise exception 'Rate per unit must be greater than zero';
    end if;

    -- Authoritative read of the unresolved entry; apply_correction() takes the
    -- write lock and re-verifies tenant membership before writing.
    select * into v_event
      from public.events
     where event_id = p_event_id;

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

    -- Idempotency guard: an already-resolved sale is a successful no-op.
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

    v_replacement := jsonb_build_object(
        'product', v_product,
        'quantity', v_calc_qty,
        'calculated_quantity', v_calc_qty,
        'unit', v_unit,
        'base_unit', v_unit,
        'amount', v_amount,
        'amount_spent', v_amount,
        'is_value_based', true,
        'unit_price_used', p_rate_per_unit,
        'price', p_rate_per_unit,
        'price_source', 'manual_resolution',
        'pricing_unresolved', false,
        'needs_weight_review', false
    );

    if v_event.payload ? 'original_text' then
        v_replacement := jsonb_set(v_replacement, '{original_text}', v_event.payload->'original_text');
    end if;

    -- VOID the unresolved original + append the resolved replacement atomically.
    -- Inserts do not fire the append-only trigger; the materialization trigger
    -- values the replacement through CASE A (is_value_based + quantity > 0).
    return public.apply_correction(p_event_id, 'SOLD', v_replacement);
end;
$$;

revoke all on function public.resolve_unpriced_sale(uuid, numeric) from public, anon;
grant execute on function public.resolve_unpriced_sale(uuid, numeric) to authenticated;

notify pgrst, 'reload schema';
