-- ============================================================================
-- Migration: 20261003000019_intent_pipeline_fixes.sql
-- Description: Fixes found in the intent/DB pipeline review:
--   1. Wholesale pack cost normalization used the SKU factor even when the
--      incoming price was already per base unit (edge pre-normalizes), which
--      divided real costs a second time. Normalize by the actual conversion
--      ratio (v_normalized / input qty) instead.
--   2. Cross-dimension movements (e.g. litres on a packet SKU) silently added
--      the raw quantity to the base unit. Skip the movement instead.
--   3. Benchmark lookup in handle_new_event is now deterministic (exact
--      key/canonical first, then commodity_key), and the duplicated
--      'sarson tel' alias is removed from the generic 'oil' entry.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Remove the ambiguous alias from the generic oil benchmark
-- ----------------------------------------------------------------------------
update public.commodity_reference_prices
   set aliases = coalesce((
        select array_agg(a)
        from unnest(aliases) a
        where lower(a) not in ('sarson tel', 'sarson ka tel')
   ), '{}'::text[]),
   updated_at = now()
 where commodity_key = 'oil';

-- ----------------------------------------------------------------------------
-- 1. Correct, dimension-safe inventory movement upsert
-- ----------------------------------------------------------------------------
create or replace function public.upsert_inventory_movement(
    p_user uuid,
    p_name text,
    p_unit text,
    p_signed_qty numeric,
    p_price numeric default null,
    p_price_kind text default null,
    p_product_id text default null,
    p_store uuid default null
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
    v_input_base text;
    v_ratio numeric;
begin
    if v_clean_name is null or length(v_clean_name) = 0 then
        return;
    end if;

    if p_store is not null then
        select base_unit, secondary_unit, conversion_factor, category, last_purchase_price
          into v_base, v_secondary, v_factor, v_category, v_existing_cost
          from public.inventory
         where store_id = p_store and lower(trim(name)) = lower(v_clean_name)
         for share;
    else
        select base_unit, secondary_unit, conversion_factor, category, last_purchase_price
          into v_base, v_secondary, v_factor, v_category, v_existing_cost
          from public.inventory
         where user_id = p_user and store_id is null and lower(trim(name)) = lower(v_clean_name)
         for share;
    end if;

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

    -- Refuse cross-dimension movements (litres on a packet SKU, kg on a
    -- litre SKU, ...) instead of adding a raw quantity to the base unit.
    v_input_base := public.resolve_unit_base(p_unit);
    if v_input_base is not null
       and v_base is not null
       and lower(v_input_base) <> lower(v_base) then
        return;
    end if;

    v_normalized := public.convert_to_base_unit(p_signed_qty, p_unit, v_base, v_secondary, v_factor);

    -- Normalize cost by the actual conversion applied (base units per input
    -- unit). Edge-normalized events arrive already in base units (ratio 1)
    -- and must not be divided by the SKU factor again.
    if p_price is not null and p_price > 0 and p_price_kind = 'COST' then
        v_ratio := case
            when p_signed_qty is not null and p_signed_qty <> 0 then v_normalized / p_signed_qty
            else null
        end;
        if v_ratio is not null and v_ratio > 0 then
            v_unit_cost := round(p_price / v_ratio, 2);
        else
            v_unit_cost := p_price;
        end if;
    end if;

    if p_store is not null then
        insert into public.inventory (
            user_id, store_id, product_id, name, quantity, unit, base_unit, secondary_unit, conversion_factor, category,
            last_purchase_price, selling_price
        )
        values (
            p_user, p_store, p_product_id, v_clean_name, v_normalized, v_base, v_base, v_secondary, v_factor, v_category,
            v_unit_cost,
            case when p_price_kind = 'SELL' and p_price > 0 then p_price else null end
        )
        on conflict (store_id, (lower(trim(name)))) do update set
            quantity = public.inventory.quantity + excluded.quantity,
            product_id = coalesce(public.inventory.product_id, excluded.product_id),
            category = case when public.inventory.category = 'GENERAL' and excluded.category <> 'GENERAL' then excluded.category else public.inventory.category end,
            last_purchase_price = coalesce(excluded.last_purchase_price, public.inventory.last_purchase_price),
            selling_price = coalesce(public.inventory.selling_price, excluded.selling_price),
            updated_at = now();
    else
        insert into public.inventory (
            user_id, product_id, name, quantity, unit, base_unit, secondary_unit, conversion_factor, category,
            last_purchase_price, selling_price
        )
        values (
            p_user, p_product_id, v_clean_name, v_normalized, v_base, v_base, v_secondary, v_factor, v_category,
            v_unit_cost,
            case when p_price_kind = 'SELL' and p_price > 0 then p_price else null end
        )
        on conflict (user_id, (lower(trim(name)))) where store_id is null do update set
            quantity = public.inventory.quantity + excluded.quantity,
            product_id = coalesce(public.inventory.product_id, excluded.product_id),
            category = case when public.inventory.category = 'GENERAL' and excluded.category <> 'GENERAL' then excluded.category else public.inventory.category end,
            last_purchase_price = coalesce(excluded.last_purchase_price, public.inventory.last_purchase_price),
            selling_price = coalesce(public.inventory.selling_price, excluded.selling_price),
            updated_at = now();
    end if;
end;
$$;

revoke all on function public.upsert_inventory_movement(uuid, text, text, numeric, numeric, text, text, uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. Deterministic benchmark lookup in the materialization trigger
--    (only the value-based Tier 3 query changes; everything else is 0017)
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
    sid uuid := new.store_id;
    v_voided text;
    v_lock_key text;

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
    v_voided := nullif(p->>'voided_event_id', '');

    -- Serialize duplicate ledger rows. A BEFORE INSERT trigger runs before
    -- ON CONFLICT discards the tuple, so without this guard a replay would
    -- materialize the same stock movement twice.
    v_lock_key := case
        when new.type = 'VOID' and v_voided is not null then 'void:' || v_voided
        else new.user_id::text || ':' || new.ledger_event_id
    end;
    perform pg_advisory_xact_lock(hashtextextended(v_lock_key, 0));

    if new.type = 'VOID' then
        if v_voided is not null and exists (
            select 1 from public.events v
            where v.type = 'VOID'
              and v.payload->>'voided_event_id' = v_voided
              and (
                    (new.store_id is not null and v.store_id = new.store_id)
                    or (new.store_id is null and v.store_id is null and v.user_id = new.user_id)
                  )
        ) then
            return new;
        end if;
    elsif exists (
        select 1 from public.events e
        where e.user_id = new.user_id and e.ledger_event_id = new.ledger_event_id
    ) then
        return new;
    end if;

    if new.type in ('PURCHASED', 'SOLD', 'ADJUSTED', 'WRITE_OFF', 'CUSTOMER_RETURN', 'VENDOR_RETURN', 'PRICE_UPDATED')
        and item_name is null then
        return new;
    end if;

    if new.type = 'PURCHASED' then
        perform public.upsert_inventory_movement(uid, item_name, item_unit, qty, price, 'COST', item_product_id, sid);

    elsif new.type = 'SOLD' then
        -- VALUE-BASED SALE CASE A: Upstream already pre-calculated quantity
        if is_val_flag and qty > 0 then
            v_price_used := coalesce(public.safe_numeric(p->>'unit_price_used'), price);
            v_base_unit := coalesce(item_unit, public.resolve_unit_base(item_unit), 'kg');
            perform public.upsert_inventory_movement(uid, item_name, v_base_unit, -qty, v_price_used, 'SELL', item_product_id, sid);

        -- VALUE-BASED SALE CASE B: Needs DB resolution
        elsif (raw_qty is null or raw_qty = 0 or is_val_flag) and amount is not null and amount > 0 then
            if sid is not null then
                select selling_price, last_purchase_price, base_unit, category
                  into v_selling_price, v_cost_price, v_base_unit, v_cat
                  from public.inventory
                 where store_id = sid and lower(trim(name)) = lower(item_name)
                 for share;
            else
                select selling_price, last_purchase_price, base_unit, category
                  into v_selling_price, v_cost_price, v_base_unit, v_cat
                  from public.inventory
                 where user_id = uid and store_id is null and lower(trim(name)) = lower(item_name)
                 for share;
            end if;

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

            -- Tier 3: Benchmark Reference Registry (deterministic precedence)
            else
                select benchmark_price, base_unit
                  into v_benchmark_price, v_benchmark_unit
                  from public.commodity_reference_prices
                 where lower(commodity_key) = lower(item_name)
                    or lower(canonical_name) = lower(item_name)
                    or exists (select 1 from unnest(aliases) a where lower(a) = lower(item_name))
                 order by
                    (lower(commodity_key) = lower(item_name)) desc,
                    (lower(canonical_name) = lower(item_name)) desc,
                    commodity_key
                 limit 1;

                if v_benchmark_price is not null and v_benchmark_price > 0 then
                    v_price_used := v_benchmark_price;
                    v_price_source := 'commodity_reference';
                    v_base_unit := coalesce(v_base_unit, v_benchmark_unit, 'kg');
                    v_calc_qty := round(amount / v_price_used, 4);
                else
                    v_price_source := 'unresolved';
                    v_calc_qty := null;
                end if;
            end if;

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

                perform public.upsert_inventory_movement(uid, item_name, v_base_unit, -v_calc_qty, v_price_used, 'SELL', item_product_id, sid);
            else
                new.payload := jsonb_set(new.payload, '{pricing_unresolved}', 'true'::jsonb);
                new.payload := jsonb_set(new.payload, '{needs_weight_review}', 'true'::jsonb);
                new.payload := jsonb_set(new.payload, '{quantity}', '0'::jsonb);
                new.payload := jsonb_set(new.payload, '{unit}', to_jsonb(v_base_unit));
            end if;

        else
            perform public.upsert_inventory_movement(uid, item_name, item_unit, -qty, price, 'SELL', item_product_id, sid);
        end if;

    elsif new.type in ('WRITE_OFF', 'VENDOR_RETURN') then
        perform public.upsert_inventory_movement(uid, item_name, item_unit, -qty, null, null, null, sid);

    elsif new.type = 'CUSTOMER_RETURN' then
        perform public.upsert_inventory_movement(uid, item_name, item_unit, qty, null, null, null, sid);

    elsif new.type = 'ADJUSTED' then
        perform public.upsert_inventory_movement(uid, item_name, item_unit, delta, null, null, item_product_id, sid);

    elsif new.type = 'PRICE_UPDATED' then
        if sid is not null then
            update public.inventory set
                selling_price = case when p->>'priceType' = 'SELL' and price is not null then price else selling_price end,
                last_purchase_price = case when p->>'priceType' = 'COST' and price is not null then price else last_purchase_price end,
                updated_at = now()
            where store_id = sid and lower(trim(name)) = lower(item_name);
        else
            update public.inventory set
                selling_price = case when p->>'priceType' = 'SELL' and price is not null then price else selling_price end,
                last_purchase_price = case when p->>'priceType' = 'COST' and price is not null then price else last_purchase_price end,
                updated_at = now()
            where user_id = uid and store_id is null and lower(trim(name)) = lower(item_name);
        end if;

    elsif new.type = 'VOID' then
        declare
            original public.events%rowtype;
            original_name text;
            original_unit text;
            original_qty numeric;
            original_delta numeric;
            target_store uuid;
        begin
            select * into original
            from public.events
            where event_id = v_voided::uuid
              and (
                    (new.store_id is not null and store_id = new.store_id)
                    or (new.store_id is null and store_id is null and user_id = uid)
                  );

            if found then
                target_store := coalesce(original.store_id, new.store_id);

                original_name := nullif(trim(original.payload->>'product'), '');

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
                        perform public.upsert_inventory_movement(uid, original_name, original_unit, -original_qty, null, null, null, target_store);
                    elsif original.type in ('SOLD', 'WRITE_OFF', 'VENDOR_RETURN') then
                        perform public.upsert_inventory_movement(uid, original_name, original_unit, original_qty, null, null, null, target_store);
                    elsif original.type = 'ADJUSTED' then
                        perform public.upsert_inventory_movement(uid, original_name, original_unit, -original_delta, null, null, null, target_store);
                    end if;
                end if;
            end if;
        end;
    end if;

    return new;
end;
$$;

notify pgrst, 'reload schema';
