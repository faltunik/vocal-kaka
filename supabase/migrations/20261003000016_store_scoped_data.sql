-- ============================================================================
-- Migration: 20261003000016_store_scoped_data.sql
-- Description: Scope inventory and the event ledger to stores so family
--              members and staff share one live catalog:
--                1. Store-scoped unique product identity.
--                2. upsert_inventory_movement / handle_new_event accept store_id.
--                3. Store-member RLS on inventory and events.
--                4. Store-aware VOID, apply_correction and resolve_unpriced_sale.
--                5. active_events excludes voided originals across all members.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Store-scoped product identity (user scope remains for legacy/null rows)
-- ----------------------------------------------------------------------------
create unique index if not exists inventory_store_id_lower_trim_name_key
    on public.inventory (store_id, lower(trim(name)));

-- The legacy per-user identity must only apply to rows without a store,
-- otherwise the same product could not exist in two stores of one owner.
drop index if exists public.inventory_user_id_lower_trim_name_key;
create unique index if not exists inventory_user_id_lower_trim_name_key
    on public.inventory (user_id, lower(trim(name)))
    where store_id is null;

-- A given ledger event can only be voided once, by any actor in the store.
drop index if exists public.events_voided_event_unique;
create unique index if not exists events_voided_event_global_unique
    on public.events ((payload->>'voided_event_id'))
    where type = 'VOID';

-- Tenant read path for the live ledger
create index if not exists events_active_store_created_idx
    on public.events (store_id, created_at desc)
    where type <> 'VOID';

-- ----------------------------------------------------------------------------
-- 1b. Harden invite-code generation: only the store owner may rotate the code
--     (migration/backfill runs with a null auth.uid() and is allowed through).
-- ----------------------------------------------------------------------------
create or replace function public.generate_store_invite_code(p_store_id UUID)
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
    if auth.uid() is not null and not exists (
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
    set invite_code = v_code, updated_at = now()
    where id = p_store_id;

    return v_code;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Store-aware inventory movement upsert
--    p_store = null keeps the legacy per-user behaviour.
-- ----------------------------------------------------------------------------
drop function if exists public.upsert_inventory_movement(uuid, text, text, numeric, numeric, text, text);

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
         where user_id = p_user and lower(trim(name)) = lower(v_clean_name)
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
-- 3. Store-aware event materialization trigger
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
                 where user_id = uid and lower(trim(name)) = lower(item_name)
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

            -- Tier 3: Benchmark Reference Registry
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
            where user_id = uid and lower(trim(name)) = lower(item_name);
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
            where event_id = nullif(p->>'voided_event_id', '')::uuid
              and (
                    (new.store_id is not null and store_id = new.store_id)
                    or (new.store_id is null and user_id = uid)
                  );

            if found then
                target_store := coalesce(original.store_id, new.store_id);

                original_name := nullif(trim(original.payload->>'product'), '');

                -- Prevent double-conversion bug: prefer authoritative normalized values
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

-- ----------------------------------------------------------------------------
-- 4. Store-aware unpriced value-sale resolution
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
    elsif v_event.user_id <> auth.uid() then
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
-- 5. Store-aware atomic corrections (VOID + replacement)
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
    v_event public.events%rowtype;
    v_inserted int;
begin
    if uid is null then
        raise exception 'not authenticated';
    end if;

    select * into v_event
      from public.events
     where event_id = p_voided_event_id;

    if not found then
        raise exception 'event not found';
    end if;

    -- Owners correct their own ledger; staff/family correct events in their store
    if v_event.store_id is not null then
        if not exists (
            select 1 from public.store_members
            where store_id = v_event.store_id and user_id = uid
        ) then
            raise exception 'event not found';
        end if;
    elsif v_event.user_id <> uid then
        raise exception 'event not found';
    end if;

    -- The global voided-event unique index makes this idempotent across members
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
        -- Already voided (retry or another store member corrected it first)
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
-- 6. Store-member RLS for inventory and the ledger
--    (permissive policies OR with the legacy owner policies)
-- ----------------------------------------------------------------------------
drop policy if exists "inventory_store_members" on public.inventory;
create policy "inventory_store_members" on public.inventory
    for all to authenticated
    using (store_id is not null and public.is_store_member(store_id))
    with check (store_id is not null and public.is_store_member(store_id));

drop policy if exists "events_store_members_select" on public.events;
create policy "events_store_members_select" on public.events
    for select to authenticated
    using (store_id is not null and public.is_store_member(store_id));

drop policy if exists "events_store_members_insert" on public.events;
create policy "events_store_members_insert" on public.events
    for insert to authenticated
    with check (store_id is not null and public.is_store_member(store_id));

-- ----------------------------------------------------------------------------
-- 7. active_events: voided originals disappear for every store member
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
        or (e.store_id is null and v.user_id = e.user_id)
      )
  );

grant select on public.active_events to authenticated;
grant select on public.active_events to service_role;

notify pgrst, 'reload schema';
