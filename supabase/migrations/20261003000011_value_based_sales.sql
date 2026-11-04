-- ============================================================================
-- Migration: 20261003000011_value_based_sales.sql
-- Description: Value-based loose commodity sales engine ("Rupee-First"),
--              commodity benchmark reference registry, and price-to-weight
--              back-calculation trigger supporting is_value_based, amount_spent,
--              and unit_price_used.
-- ============================================================================

-- 1. Commodity Benchmark Reference Registry Table
create table if not exists public.commodity_reference_prices (
    commodity_key text primary key,
    canonical_name text not null,
    base_unit text not null check (base_unit in ('kg', 'l', 'pcs', 'm')),
    benchmark_price numeric not null check (benchmark_price > 0),
    aliases text[] not null default '{}',
    updated_at timestamptz not null default now()
);

create index if not exists commodity_ref_aliases_idx 
    on public.commodity_reference_prices using gin (aliases);

-- Enable Row Level Security
alter table public.commodity_reference_prices enable row level security;
drop policy if exists "commodity_reference_prices_read" on public.commodity_reference_prices;
create policy "commodity_reference_prices_read" on public.commodity_reference_prices
    for select to authenticated using (true);
grant select on public.commodity_reference_prices to authenticated;

-- Seed Indian Kirana Standard Loose Commodities Benchmark
insert into public.commodity_reference_prices (commodity_key, canonical_name, base_unit, benchmark_price, aliases)
values
    ('sugar', 'Sugar', 'kg', 44.00, array['cheeni', 'chini', 'shakkar', 'sakhar', 'चीनी', 'शक्कर']),
    ('cumin', 'Cumin', 'kg', 420.00, array['jeera', 'jira', 'zeera', 'जीरा']),
    ('mustard_oil', 'Mustard Oil', 'l', 145.00, array['sarson tel', 'sarson ka tel', 'rai tel', 'सरसों तेल']),
    ('oil', 'Oil', 'l', 140.00, array['tel', 'cooking oil', 'edible oil', 'तेल']),
    ('wheat_flour', 'Atta', 'kg', 38.00, array['aata', 'aashirvaad aata', 'gehu aata', 'आटा']),
    ('rice', 'Rice', 'kg', 52.00, array['chawal', 'basmati', 'kolam', 'चावल']),
    ('toor_dal', 'Toor Dal', 'kg', 160.00, array['arhar dal', 'tuvar dal', 'toor daal', 'अरहर दाल']),
    ('moong_dal', 'Moong Dal', 'kg', 120.00, array['mung dal', 'peeli dal', 'मूंग दाल']),
    ('besan', 'Besan', 'kg', 85.00, array['gram flour', 'chana besan', 'बेसन']),
    ('paneer', 'Paneer', 'kg', 360.00, array['fresh paneer', 'cottage cheese', 'पनीर']),
    ('cashew', 'Cashew', 'kg', 850.00, array['kaju', 'काजू']),
    ('coriander_powder', 'Coriander Powder', 'kg', 240.00, array['dhaniya powder', 'dhaniya patti', 'धनिया']),
    ('onion', 'Onion', 'kg', 35.00, array['pyaaz', 'kanda', 'प्याज']),
    ('potato', 'Potato', 'kg', 25.00, array['aloo', 'alu', 'आलू'])
on conflict (commodity_key) do update set
    benchmark_price = excluded.benchmark_price,
    aliases = excluded.aliases,
    updated_at = now();

-- Index for value-based queries on events ledger
create index if not exists events_value_based_idx
    on public.events ((payload->>'is_value_based'))
    where (payload->>'is_value_based') = 'true';

-- 2. Enhanced Trigger: Authoritative Price-to-Weight Back-Calculation & Ledger Processing
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
    raw_qty numeric := nullif(p->>'quantity', '')::numeric;
    qty numeric := coalesce(raw_qty, 0);
    delta numeric := coalesce(nullif(p->>'delta', '')::numeric, 0);
    amount numeric := coalesce(
        nullif(p->>'amount_spent', '')::numeric,
        nullif(p->>'amount', '')::numeric
    );
    price numeric := nullif(p->>'price', '')::numeric;
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
begin
    if new.type in ('PURCHASED', 'SOLD', 'ADJUSTED', 'WRITE_OFF', 'CUSTOMER_RETURN', 'VENDOR_RETURN', 'PRICE_UPDATED')
        and item_name is null then
        return new;
    end if;

    if new.type = 'PURCHASED' then
        perform public.upsert_inventory_movement(uid, item_name, item_unit, qty, price, 'COST', item_product_id);

    elsif new.type = 'SOLD' then
        -- VALUE-BASED SALE CASE A: Already resolved upstream by Edge Function (quantity pre-calculated)
        if is_val_flag and qty > 0 then
            v_price_used := coalesce(nullif(p->>'unit_price_used', '')::numeric, price);
            v_base_unit := coalesce(item_unit, public.resolve_unit_base(item_unit), 'kg');

            perform public.upsert_inventory_movement(
                uid, item_name, v_base_unit, -qty, v_price_used, 'SELL', item_product_id
            );

        -- VALUE-BASED SALE CASE B: Needs DB resolution (amount is positive, quantity is null/zero or explicitly marked)
        elsif (raw_qty is null or raw_qty = 0 or is_val_flag) and amount is not null and amount > 0 then
            -- Lookup active inventory item details
            select selling_price, last_purchase_price, base_unit
              into v_selling_price, v_cost_price, v_base_unit
              from public.inventory
             where user_id = uid and lower(name) = lower(item_name);

            if v_base_unit is null then
                v_base_unit := coalesce(public.resolve_unit_base(item_unit), 'kg');
            end if;

            -- Tier 1: Existing Selling Price
            if v_selling_price is not null and v_selling_price > 0 then
                v_price_used := v_selling_price;
                v_price_source := 'inventory_selling_price';
                v_calc_qty := round(amount / v_price_used, 3);

            -- Tier 2: Cost Price with 12% Kirana Markup
            elsif v_cost_price is not null and v_cost_price > 0 then
                v_price_used := round(v_cost_price * 1.12, 2);
                v_price_source := 'purchase_price_markup';
                v_calc_qty := round(amount / v_price_used, 3);

            -- Tier 3: Benchmark Reference Registry
            else
                select benchmark_price, base_unit
                  into v_benchmark_price, v_benchmark_unit
                  from public.commodity_reference_prices
                 where lower(canonical_name) = lower(item_name)
                    or exists (
                        select 1 from unnest(aliases) a 
                        where lower(a) = lower(item_name)
                    )
                 limit 1;

                if v_benchmark_price is not null and v_benchmark_price > 0 then
                    v_price_used := v_benchmark_price;
                    v_price_source := 'commodity_reference';
                    v_base_unit := coalesce(v_base_unit, v_benchmark_unit, 'kg');
                    v_calc_qty := round(amount / v_price_used, 3);
                else
                    -- Tier 4: Unresolved Pricing (Financial sale only, zero stock deduction)
                    v_price_source := 'unresolved';
                    v_calc_qty := null;
                end if;
            end if;

            -- Enrich event payload with value-based metadata
            new.payload := jsonb_set(new.payload, '{is_value_based}', 'true'::jsonb);
            new.payload := jsonb_set(new.payload, '{price_source}', to_jsonb(v_price_source));
            new.payload := jsonb_set(new.payload, '{amount_spent}', to_jsonb(amount));
            new.payload := jsonb_set(new.payload, '{amount}', to_jsonb(amount));

            if v_calc_qty is not null and v_calc_qty > 0 then
                new.payload := jsonb_set(new.payload, '{calculated_quantity}', to_jsonb(v_calc_qty));
                new.payload := jsonb_set(new.payload, '{quantity}', to_jsonb(v_calc_qty));
                new.payload := jsonb_set(new.payload, '{unit}', to_jsonb(v_base_unit));
                new.payload := jsonb_set(new.payload, '{unit_price_used}', to_jsonb(v_price_used));
                new.payload := jsonb_set(new.payload, '{pricing_unresolved}', 'false'::jsonb);
                new.payload := jsonb_set(new.payload, '{needs_weight_review}', 'false'::jsonb);

                -- Perform authoritative inventory stock deduction
                perform public.upsert_inventory_movement(
                    uid, item_name, v_base_unit, -v_calc_qty, v_price_used, 'SELL', item_product_id
                );
            else
                -- Pricing could not be resolved: Record 0 stock delta, flag for user review
                new.payload := jsonb_set(new.payload, '{pricing_unresolved}', 'true'::jsonb);
                new.payload := jsonb_set(new.payload, '{needs_weight_review}', 'true'::jsonb);
                new.payload := jsonb_set(new.payload, '{quantity}', '0'::jsonb);
                new.payload := jsonb_set(new.payload, '{unit}', to_jsonb(v_base_unit));
            end if;

        else
            -- Standard quantity-based sale
            perform public.upsert_inventory_movement(
                uid, item_name, item_unit, -qty, price, 'SELL', item_product_id
            );
        end if;

    elsif new.type in ('WRITE_OFF', 'VENDOR_RETURN') then
        perform public.upsert_inventory_movement(uid, item_name, item_unit, -qty);

    elsif new.type = 'CUSTOMER_RETURN' then
        perform public.upsert_inventory_movement(uid, item_name, item_unit, qty);

    elsif new.type = 'ADJUSTED' then
        perform public.upsert_inventory_movement(uid, item_name, item_unit, delta, null, null, item_product_id);

    elsif new.type = 'PRICE_UPDATED' then
        update public.inventory set
            selling_price = case
                when p->>'priceType' = 'SELL' and price is not null then price
                else selling_price
            end,
            last_purchase_price = case
                when p->>'priceType' = 'COST' and price is not null then price
                else last_purchase_price
            end,
            updated_at = now()
        where user_id = uid and lower(name) = lower(item_name);

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
                original_unit := nullif(trim(original.payload->>'unit'), '');
                original_qty := coalesce(
                    nullif(original.payload->>'calculated_quantity', '')::numeric,
                    nullif(original.payload->>'normalized_quantity', '')::numeric,
                    nullif(original.payload->>'quantity', '')::numeric,
                    0
                );
                original_delta := coalesce(
                    nullif(original.payload->>'normalized_delta', '')::numeric,
                    nullif(original.payload->>'delta', '')::numeric,
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

-- 3. RPC to Resolve Pending Unpriced Value Sales
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

    select * into v_event
      from public.events
     where event_id = p_event_id and user_id = auth.uid();

    if not found then
        return false;
    end if;

    v_amount := coalesce(
        nullif(v_event.payload->>'amount_spent', '')::numeric,
        nullif(v_event.payload->>'amount', '')::numeric
    );
    v_product := v_event.payload->>'product';
    v_unit := coalesce(v_event.payload->>'unit', 'kg');

    if v_amount is null or v_amount <= 0 then
        return false;
    end if;

    v_calc_qty := round(v_amount / p_rate_per_unit, 3);

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

notify pgrst, 'reload schema';
