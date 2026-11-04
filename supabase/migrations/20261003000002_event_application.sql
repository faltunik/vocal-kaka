-- M0.2 Event application: materialize inventory from the append-only ledger.
-- Idempotency is enforced by the unique (user_id, ledger_event_id) constraint;
-- re-inserting the same ledger event fails before the trigger runs.

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
    qty numeric := coalesce(nullif(p->>'quantity', '')::numeric, 0);
    price numeric := nullif(p->>'price', '')::numeric;
    uid uuid := new.user_id;
begin
    -- All stock-affecting events need a product name
    if new.type in ('PURCHASED', 'SOLD', 'ADJUSTED', 'WRITE_OFF', 'CUSTOMER_RETURN', 'VENDOR_RETURN', 'PRICE_UPDATED')
        and item_name is null then
        return new;
    end if;

    if new.type = 'PURCHASED' then
        insert into public.inventory (user_id, product_id, name, quantity, unit, last_purchase_price)
        values (uid, item_product_id, item_name, qty, coalesce(nullif(p->>'unit', ''), 'units'), price)
        on conflict (user_id, name) do update set
            quantity = public.inventory.quantity + excluded.quantity,
            last_purchase_price = coalesce(excluded.last_purchase_price, public.inventory.last_purchase_price),
            unit = coalesce(nullif(excluded.unit, ''), public.inventory.unit),
            product_id = coalesce(public.inventory.product_id, excluded.product_id),
            updated_at = now();

    elsif new.type = 'SOLD' then
        update public.inventory set
            quantity = quantity - qty,
            selling_price = coalesce(price, selling_price),
            updated_at = now()
        where user_id = uid and name = item_name;

    elsif new.type in ('WRITE_OFF', 'VENDOR_RETURN') then
        update public.inventory set
            quantity = quantity - qty,
            updated_at = now()
        where user_id = uid and name = item_name;

    elsif new.type = 'CUSTOMER_RETURN' then
        update public.inventory set
            quantity = quantity + qty,
            updated_at = now()
        where user_id = uid and name = item_name;

    elsif new.type = 'ADJUSTED' then
        update public.inventory set
            quantity = quantity + coalesce(nullif(p->>'delta', '')::numeric, 0),
            updated_at = now()
        where user_id = uid and name = item_name;

    elsif new.type = 'PRICE_UPDATED' then
        update public.inventory set
            selling_price = case when p->>'priceType' = 'SELL' then price else selling_price end,
            last_purchase_price = case when p->>'priceType' = 'COST' then price else last_purchase_price end,
            updated_at = now()
        where user_id = uid and name = item_name;

    elsif new.type = 'VOID' then
        declare
            original public.events%rowtype;
            original_name text;
            original_qty numeric;
        begin
            select * into original
            from public.events
            where event_id = nullif(p->>'voided_event_id', '')::uuid
              and user_id = uid;

            if found then
                original_name := nullif(trim(original.payload->>'product'), '');
                original_qty := coalesce(nullif(original.payload->>'quantity', '')::numeric, 0);

                if original_name is not null then
                    if original.type in ('PURCHASED', 'CUSTOMER_RETURN') then
                        update public.inventory set
                            quantity = quantity - original_qty,
                            updated_at = now()
                        where user_id = uid and name = original_name;
                    elsif original.type in ('SOLD', 'WRITE_OFF', 'VENDOR_RETURN') then
                        update public.inventory set
                            quantity = quantity + original_qty,
                            updated_at = now()
                        where user_id = uid and name = original_name;
                    elsif original.type = 'ADJUSTED' then
                        update public.inventory set
                            quantity = quantity - coalesce(nullif(original.payload->>'delta', '')::numeric, 0),
                            updated_at = now()
                        where user_id = uid and name = original_name;
                    end if;
                end if;
            end if;
        end;
    end if;

    return new;
end;
$$;

create trigger on_new_event
    after insert on public.events
    for each row execute function public.handle_new_event();
