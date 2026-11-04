-- M0.10 Convert existing stock to base units and rewrite the materialization
-- trigger to normalize every movement through the unit registry.
--
-- Run after 009 (registry seeded). Existing rows are converted in place;
-- the update is idempotent because base units convert to themselves.

-- ---------------------------------------------------------------------------
-- One movement helper: resolves the SKU's base/secondary configuration,
-- converts the signed quantity, and upserts the inventory row.
-- ---------------------------------------------------------------------------
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
    v_base text;
    v_secondary text;
    v_factor numeric;
    v_normalized numeric;
begin
    select base_unit, secondary_unit, conversion_factor
      into v_base, v_secondary, v_factor
      from public.inventory
     where user_id = p_user and lower(name) = lower(p_name);

    if v_base is null then
        v_base := coalesce(public.resolve_unit_base(p_unit), 'pcs');
    end if;

    v_normalized := public.convert_to_base_unit(p_signed_qty, p_unit, v_base, v_secondary, v_factor);

    insert into public.inventory (user_id, product_id, name, quantity, unit, base_unit, secondary_unit, conversion_factor)
    values (p_user, p_product_id, p_name, v_normalized, v_base, v_base, v_secondary, v_factor)
    on conflict (user_id, (lower(name))) do update set
        quantity = public.inventory.quantity + excluded.quantity,
        product_id = coalesce(public.inventory.product_id, excluded.product_id),
        updated_at = now();

    if p_price is not null then
        if p_price_kind = 'COST' then
            update public.inventory set last_purchase_price = p_price, updated_at = now()
            where user_id = p_user and lower(name) = lower(p_name);
        elsif p_price_kind = 'SELL' then
            update public.inventory set selling_price = p_price, updated_at = now()
            where user_id = p_user and lower(name) = lower(p_name);
        end if;
    end if;
end;
$$;

revoke all on function public.upsert_inventory_movement(uuid, text, text, numeric, numeric, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Migrate existing inventory rows into canonical base units
-- ---------------------------------------------------------------------------
update public.inventory
set
    quantity = public.convert_to_base_unit(
        quantity,
        unit,
        coalesce(public.resolve_unit_base(unit), 'pcs'),
        null,
        null
    ),
    base_unit = coalesce(public.resolve_unit_base(unit), 'pcs'),
    unit = coalesce(public.resolve_unit_base(unit), 'pcs');

-- ---------------------------------------------------------------------------
-- Trigger: every stock movement is normalized to the SKU's base unit
-- ---------------------------------------------------------------------------
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
    qty numeric := coalesce(nullif(p->>'quantity', '')::numeric, 0);
    delta numeric := coalesce(nullif(p->>'delta', '')::numeric, 0);
    price numeric := nullif(p->>'price', '')::numeric;
    uid uuid := new.user_id;
begin
    if new.type in ('PURCHASED', 'SOLD', 'ADJUSTED', 'WRITE_OFF', 'CUSTOMER_RETURN', 'VENDOR_RETURN', 'PRICE_UPDATED')
        and item_name is null then
        return new;
    end if;

    if new.type = 'PURCHASED' then
        perform public.upsert_inventory_movement(uid, item_name, item_unit, qty, price, 'COST', item_product_id);

    elsif new.type = 'SOLD' then
        perform public.upsert_inventory_movement(uid, item_name, item_unit, -qty, price, 'SELL', item_product_id);

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

notify pgrst, 'reload schema';
