-- ============================================================================
-- Migration: 20261003000014_trigger_concurrency_and_ledger_hardening.sql
-- Description:
--   1. Switches on_new_event to BEFORE INSERT so payload enrichment persists.
--   2. Fixes double-conversion bug on VOID (prevents 1000x stock corruption).
--   3. Normalizes wholesale pack cost to unit cost (prevents fake -₹2056 losses).
--   4. Eliminates split-brain dual updates in upsert_inventory_movement.
--   5. Adds FOR UPDATE row locking and idempotency to resolve_unpriced_sale.
--   6. Hardens apply_correction against duplicate replay.
--   7. Aligns category margins across all supported categories.
--   8. Hardens unit conversion for secondary packaging aliases.
--   9. Adds safe_numeric helper to prevent crashes on non-numeric payload fields.
--  10. Enforces trimmed unique product names and non-negative price constraints.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Safe Numeric Casting Helper (prevents crashes on non-numeric strings)
-- ----------------------------------------------------------------------------
create or replace function public.safe_numeric(p_val text)
returns numeric
language sql
immutable
as $$
    select case 
        when p_val is null or trim(p_val) = '' then null
        when trim(p_val) ~ '^[+-]?[0-9]+(\.[0-9]+)?$' then trim(p_val)::numeric 
        else null 
    end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Clean Unique Index on Trimmed Lowercase Product Name
-- ----------------------------------------------------------------------------
drop index if exists public.inventory_user_id_lower_name_key;
drop index if exists public.inventory_user_id_lower_trim_name_key;

create unique index if not exists inventory_user_id_lower_trim_name_key
    on public.inventory (user_id, lower(trim(name)));

-- ----------------------------------------------------------------------------
-- 3. Non-Negative Price and Non-Empty Name Constraints
-- ----------------------------------------------------------------------------
alter table public.inventory
    drop constraint if exists inventory_name_non_empty,
    drop constraint if exists inventory_selling_price_positive,
    drop constraint if exists inventory_purchase_price_positive;

alter table public.inventory
    add constraint inventory_name_non_empty check (length(trim(name)) > 0),
    add constraint inventory_selling_price_positive check (selling_price is null or selling_price >= 0),
    add constraint inventory_purchase_price_positive check (last_purchase_price is null or last_purchase_price >= 0);

-- ----------------------------------------------------------------------------
-- 4. Full Category Default Margin Parity
-- ----------------------------------------------------------------------------
create or replace function public.get_category_default_margin(p_category text)
returns numeric
language sql
immutable
as $$
    select case upper(coalesce(trim(p_category), 'GENERAL'))
        when 'FMCG' then 0.12
        when 'STAPLES' then 0.06
        when 'SPICES' then 0.08
        when 'LOOSE_GRAINS' then 0.06
        when 'EDIBLE_OIL' then 0.05
        when 'DAIRY_BAKERY' then 0.08
        when 'DAIRY' then 0.08
        else 0.10
    end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Hardened Unit Conversion for Secondary Packaging Aliases
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

    -- SKU custom secondary packaging conversion (e.g. bori, peti, box)
    -- Matches exact code, or base unit equivalence, or registered aliases
    if v_secondary is not null and p_custom_factor is not null and p_custom_factor > 0 then
        if v_unit = v_secondary
           or public.resolve_unit_base(v_unit) = public.resolve_unit_base(v_secondary)
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
-- 6. Atomic, Single-Pass Inventory Movement Upsert with Unit Cost Normalization
-- ----------------------------------------------------------------------------
create or replace function public.upsert_inventory_movement(
    p_user uuid,
    p_name text,
    p_unit text,
    p_signed_qty numeric,
    p_price numeric default null,
    p_price_kind text default null,
    p_product_id text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_clean_name text := trim(p_name);
    v_base text;
    v_secondary text;
    v_factor numeric;
    v_normalized numeric;
    v_category text;
    v_existing_cost numeric;
    v_unit_cost numeric := null;
begin
    if v_clean_name is null or length(v_clean_name) = 0 then
        return;
    end if;

    select base_unit, secondary_unit, conversion_factor, category, last_purchase_price
      into v_base, v_secondary, v_factor, v_category, v_existing_cost
      from public.inventory
     where user_id = p_user and lower(trim(name)) = lower(v_clean_name)
     for share;

    if v_category is null then
        v_category := public.classify_product_category(v_clean_name, p_unit);
    end if;

    if v_base is null then
        v_base := coalesce(public.resolve_unit_base(p_unit), 
            case 
                when v_category in ('STAPLES', 'LOOSE_GRAINS') and lower(coalesce(p_unit, '')) in ('l', 'ml', 'liter', 'litre', 'oil') then 'l'
                when v_category in ('STAPLES', 'LOOSE_GRAINS', 'SPICES') then 'kg'
                when v_category in ('DAIRY_BAKERY', 'DAIRY') and lower(coalesce(p_unit, '')) in ('l', 'ml', 'liter', 'litre') then 'l'
                else 'pcs'
            end
        );
    end if;

    v_normalized := public.convert_to_base_unit(p_signed_qty, p_unit, v_base, v_secondary, v_factor);

    -- Calculate normalized base unit cost for wholesale packaging
    if p_price is not null and p_price > 0 and p_price_kind = 'COST' then
        v_unit_cost := p_price;
        if v_factor is not null and v_factor > 0 then
            v_unit_cost := round(p_price / v_factor, 2);
        elsif v_normalized != 0 and p_signed_qty != 0 and (v_normalized / p_signed_qty) > 1 then
            v_unit_cost := round(p_price / (v_normalized / p_signed_qty), 2);
        end if;
    end if;

    -- Atomic Insert / Update
    insert into public.inventory (
        user_id, product_id, name, quantity, unit, base_unit, secondary_unit, conversion_factor, category,
        last_purchase_price, selling_price
    )
    values (
        p_user, p_product_id, v_clean_name, v_normalized, v_base, v_base, v_secondary, v_factor, v_category,
        v_unit_cost,
        case when p_price_kind = 'SELL' and p_price > 0 then p_price else null end
    )
    on conflict (user_id, (lower(trim(name)))) do update set
        quantity = public.inventory.quantity + excluded.quantity,
        product_id = coalesce(public.inventory.product_id, excluded.product_id),
        category = case when public.inventory.category = 'GENERAL' and excluded.category <> 'GENERAL' then excluded.category else public.inventory.category end,
        last_purchase_price = coalesce(excluded.last_purchase_price, public.inventory.last_purchase_price),
        -- Preserve existing master catalog selling price; do not overwrite with incidental discounts
        selling_price = coalesce(public.inventory.selling_price, excluded.selling_price),
        updated_at = now();
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. BEFORE INSERT Trigger Function for Complete Payload Enrichment & Safe VOIDs
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    p jsonb := new.payload;
    item_name text := nullif(trim(p->>'product'), '');
    item_product_id text := nullif(trim(p->>'product_id'), '');
    item_unit text := nullif(trim(p->>'unit'), '');
    raw_qty numeric := public.safe_numeric(p->>'quantity');
    qty numeric := coalesce(raw_qty, 0);
    delta numeric := coalesce(public.safe_numeric(p->>'delta'), 0);
    amount numeric := coalesce(
        public.safe_numeric(p->>'amount_spent'),
        public.safe_numeric(p->>'amount')
    );
    price numeric := public.safe_numeric(p->>'price');
    is_val_flag boolean := coalesce((p->>'is_value_based')::boolean, false);
    uid uuid := new.user_id;

    v_selling_price numeric;
    v_cost_price numeric;
    v_base_unit text;
    v_benchmark_price numeric;
    v_benchmark_unit text;
    v_calc_qty numeric;
    v_price_used numeric;
    v_price_source text;
    v_cat text;
    v_margin numeric;
begin
    if new.type in ('PURCHASED', 'SOLD', 'ADJUSTED', 'WRITE_OFF', 'CUSTOMER_RETURN', 'VENDOR_RETURN', 'PRICE_UPDATED')
        and item_name is null then
        return new;
    end if;

    if new.type = 'PURCHASED' then
        perform public.upsert_inventory_movement(uid, item_name, item_unit, qty, price, 'COST', item_product_id);

    elsif new.type = 'SOLD' then
        -- VALUE-BASED SALE CASE A: Upstream already pre-calculated quantity
        if is_val_flag and qty > 0 then
            v_price_used := coalesce(public.safe_numeric(p->>'unit_price_used'), price);
            v_base_unit := coalesce(item_unit, public.resolve_unit_base(item_unit), 'kg');
            perform public.upsert_inventory_movement(uid, item_name, v_base_unit, -qty, v_price_used, 'SELL', item_product_id);

        -- VALUE-BASED SALE CASE B: Needs DB resolution (amount is positive, quantity is null/zero or explicitly marked)
        elsif (raw_qty is null or raw_qty = 0 or is_val_flag) and amount is not null and amount > 0 then
            select selling_price, last_purchase_price, base_unit, category
              into v_selling_price, v_cost_price, v_base_unit, v_cat
              from public.inventory
             where user_id = uid and lower(trim(name)) = lower(item_name)
             for share;

            if v_base_unit is null then
                v_base_unit := coalesce(public.resolve_unit_base(item_unit), 'kg');
            end if;

            -- Tier 1: Existing Master Catalog Selling Price
            if v_selling_price is not null and v_selling_price > 0 then
                v_price_used := v_selling_price;
                v_price_source := 'inventory_selling_price';
                v_calc_qty := round(amount / v_price_used, 4);

            -- Tier 2: Cost Price with Category Margin Markup
            elsif v_cost_price is not null and v_cost_price > 0 then
                v_margin := public.get_category_default_margin(v_cat);
                v_price_used := round(v_cost_price * (1.0 + v_margin), 2);
                v_price_source := 'purchase_price_markup';
                v_calc_qty := round(amount / v_price_used, 4);

            -- Tier 3: Benchmark Reference Registry (matches by key, canonical name, or aliases)
            else
                select benchmark_price, base_unit
                  into v_benchmark_price, v_benchmark_unit
                  from public.commodity_reference_prices
                 where lower(commodity_key) = lower(item_name)
                    or lower(canonical_name) = lower(item_name)
                    or exists (select 1 from unnest(aliases) a where lower(a) = lower(item_name))
                 limit 1;

                if v_benchmark_price is not null and v_benchmark_price > 0 then
                    v_price_used := v_benchmark_price;
                    v_price_source := 'commodity_reference';
                    v_base_unit := coalesce(v_base_unit, v_benchmark_unit, 'kg');
                    v_calc_qty := round(amount / v_price_used, 4);
                else
                    -- Tier 4: Unresolved Pricing (Financial sale only, zero stock deduction)
                    v_price_source := 'unresolved';
                    v_calc_qty := null;
                end if;
            end if;

            -- Enrich event payload: because trigger is BEFORE INSERT, changes persist into the stored table row!
            new.payload := jsonb_set(new.payload, '{is_value_based}', 'true'::jsonb);
            new.payload := jsonb_set(new.payload, '{price_source}', to_jsonb(v_price_source));
            new.payload := jsonb_set(new.payload, '{amount_spent}', to_jsonb(amount));
            new.payload := jsonb_set(new.payload, '{amount}', to_jsonb(amount));

            if v_calc_qty is not null and v_calc_qty > 0 then
                new.payload := jsonb_set(new.payload, '{calculated_quantity}', to_jsonb(v_calc_qty));
                new.payload := jsonb_set(new.payload, '{quantity}', to_jsonb(v_calc_qty));
                new.payload := jsonb_set(new.payload, '{unit}', to_jsonb(v_base_unit));
                new.payload := jsonb_set(new.payload, '{base_unit}', to_jsonb(v_base_unit));
                new.payload := jsonb_set(new.payload, '{unit_price_used}', to_jsonb(v_price_used));
                new.payload := jsonb_set(new.payload, '{pricing_unresolved}', 'false'::jsonb);
                new.payload := jsonb_set(new.payload, '{needs_weight_review}', 'false'::jsonb);

                perform public.upsert_inventory_movement(uid, item_name, v_base_unit, -v_calc_qty, v_price_used, 'SELL', item_product_id);
            else
                new.payload := jsonb_set(new.payload, '{pricing_unresolved}', 'true'::jsonb);
                new.payload := jsonb_set(new.payload, '{needs_weight_review}', 'true'::jsonb);
                new.payload := jsonb_set(new.payload, '{quantity}', '0'::jsonb);
                new.payload := jsonb_set(new.payload, '{unit}', to_jsonb(v_base_unit));
            end if;

        else
            perform public.upsert_inventory_movement(uid, item_name, item_unit, -qty, price, 'SELL', item_product_id);
        end if;

    elsif new.type in ('WRITE_OFF', 'VENDOR_RETURN') then
        perform public.upsert_inventory_movement(uid, item_name, item_unit, -qty);

    elsif new.type = 'CUSTOMER_RETURN' then
        perform public.upsert_inventory_movement(uid, item_name, item_unit, qty);

    elsif new.type = 'ADJUSTED' then
        perform public.upsert_inventory_movement(uid, item_name, item_unit, delta, null, null, item_product_id);

    elsif new.type = 'PRICE_UPDATED' then
        update public.inventory set
            selling_price = case when p->>'priceType' = 'SELL' and price is not null then price else selling_price end,
            last_purchase_price = case when p->>'priceType' = 'COST' and price is not null then price else last_purchase_price end,
            updated_at = now()
        where user_id = uid and lower(trim(name)) = lower(item_name);

    elsif new.type = 'VOID' then
        declare
            original public.events%rowtype;
            original_name text;
            original_unit text;
            original_qty numeric;
            original_delta numeric;
        begin
            select * into original
            from public.events
            where event_id = nullif(p->>'voided_event_id', '')::uuid
              and user_id = uid;

            if found then
                original_name := nullif(trim(original.payload->>'product'), '');

                -- Prevent double-conversion bug:
                -- If the event already has an authoritative normalized quantity, pass base_unit directly!
                if original.payload->>'calculated_quantity' is not null or original.payload->>'normalized_quantity' is not null then
                    original_qty := coalesce(
                        public.safe_numeric(original.payload->>'calculated_quantity'),
                        public.safe_numeric(original.payload->>'normalized_quantity'),
                        0
                    );
                    original_unit := coalesce(
                        nullif(trim(original.payload->>'base_unit'), ''),
                        nullif(trim(original.payload->>'unit'), ''),
                        'kg'
                    );
                else
                    original_qty := coalesce(public.safe_numeric(original.payload->>'quantity'), 0);
                    original_unit := nullif(trim(original.payload->>'unit'), '');
                end if;

                original_delta := coalesce(
                    public.safe_numeric(original.payload->>'normalized_delta'),
                    public.safe_numeric(original.payload->>'delta'),
                    0
                );

                if original_name is not null then
                    if original.type in ('PURCHASED', 'CUSTOMER_RETURN') then
                        perform public.upsert_inventory_movement(uid, original_name, original_unit, -original_qty);
                    elsif original.type in ('SOLD', 'WRITE_OFF', 'VENDOR_RETURN') then
                        perform public.upsert_inventory_movement(uid, original_name, original_unit, original_qty);
                    elsif original.type = 'ADJUSTED' then
                        perform public.upsert_inventory_movement(uid, original_name, original_unit, -original_delta);
                    end if;
                end if;
            end if;
        end;
    end if;

    return new;
end;
$$;

-- Switch trigger from AFTER INSERT to BEFORE INSERT
drop trigger if exists on_new_event on public.events;
create trigger on_new_event
    before insert on public.events
    for each row execute function public.handle_new_event();

-- ----------------------------------------------------------------------------
-- 8. Hardened resolve_unpriced_sale with FOR UPDATE Locking & Idempotency Guard
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
       and user_id = auth.uid()
     for update;

    if not found then
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

    -- Apply inventory stock deduction
    perform public.upsert_inventory_movement(
        auth.uid(), v_product, v_unit, -v_calc_qty, p_rate_per_unit, 'SELL'
    );

    -- Update original event payload
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
-- 9. Hardened apply_correction with Replay Protection
-- ----------------------------------------------------------------------------
create or replace function public.apply_correction(
    p_voided_event_id uuid,
    p_replacement_type text,
    p_replacement_payload jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
    uid uuid := auth.uid();
begin
    if uid is null then
        raise exception 'not authenticated';
    end if;

    if not exists (
        select 1 from public.events
        where event_id = p_voided_event_id and user_id = uid
    ) then
        raise exception 'event not found';
    end if;

    -- Check if event was already voided to prevent duplicate replacement insertion
    if exists (
        select 1 from public.events
        where type = 'VOID' and user_id = uid and payload->>'voided_event_id' = p_voided_event_id::text
    ) then
        raise exception 'Event % has already been voided', p_voided_event_id;
    end if;

    insert into public.events (user_id, type, payload, ledger_event_id)
    values (uid, 'VOID', jsonb_build_object('voided_event_id', p_voided_event_id), 'void-' || p_voided_event_id::text);

    if p_replacement_type is not null then
        insert into public.events (user_id, type, payload, ledger_event_id)
        values (
            uid,
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
-- 10. High-Performance Partial Index for active_events View
-- ----------------------------------------------------------------------------
create index if not exists events_active_user_created_idx
    on public.events (user_id, created_at desc)
    where type <> 'VOID';

notify pgrst, 'reload schema';
