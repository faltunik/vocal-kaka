-- M0.5 Corrections, void filtering, and event-application hardening
--
-- 1. active_events view hides voided originals from all readers.
-- 2. A given event can be voided at most once (unique partial index).
-- 3. Product identity is case-insensitive (unique index on lower(name)).
-- 4. handle_new_event upserts inventory for every stock type, so sales of
--    unknown items surface as negative stock instead of silent no-ops.
-- 5. apply_correction() performs VOID + replacement atomically.

-- ---------------------------------------------------------------------------
-- 1. Reads exclude voided events
-- ---------------------------------------------------------------------------
create or replace view public.active_events
with (security_invoker = true)
as
select e.*
from public.events e
where not exists (
    select 1
    from public.events v
    where v.type = 'VOID'
      and v.user_id = e.user_id
      and v.payload->>'voided_event_id' = e.event_id::text
);

grant select on public.active_events to authenticated;
grant select on public.active_events to service_role;

-- ---------------------------------------------------------------------------
-- 2. A given event can be voided at most once
-- ---------------------------------------------------------------------------
create unique index if not exists events_voided_event_unique
    on public.events (user_id, (payload->>'voided_event_id'))
    where type = 'VOID';

-- ---------------------------------------------------------------------------
-- 3. Case-insensitive product identity
-- ---------------------------------------------------------------------------
alter table public.inventory drop constraint if exists inventory_user_id_name_key;
create unique index if not exists inventory_user_id_lower_name_key
    on public.inventory (user_id, lower(name));

-- ---------------------------------------------------------------------------
-- 4. Trigger: every stock type upserts, case-insensitive, price guards
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
        insert into public.inventory (user_id, product_id, name, quantity, unit, last_purchase_price)
        values (uid, item_product_id, item_name, qty, coalesce(item_unit, 'units'), price)
        on conflict (user_id, (lower(name))) do update set
            quantity = public.inventory.quantity + excluded.quantity,
            last_purchase_price = coalesce(excluded.last_purchase_price, public.inventory.last_purchase_price),
            unit = coalesce(item_unit, public.inventory.unit),
            product_id = coalesce(public.inventory.product_id, excluded.product_id),
            updated_at = now();

    elsif new.type = 'SOLD' then
        insert into public.inventory (user_id, name, quantity, unit, selling_price)
        values (uid, item_name, -qty, coalesce(item_unit, 'units'), price)
        on conflict (user_id, (lower(name))) do update set
            quantity = public.inventory.quantity - qty,
            selling_price = coalesce(price, public.inventory.selling_price),
            updated_at = now();

    elsif new.type in ('WRITE_OFF', 'VENDOR_RETURN') then
        insert into public.inventory (user_id, name, quantity, unit)
        values (uid, item_name, -qty, coalesce(item_unit, 'units'))
        on conflict (user_id, (lower(name))) do update set
            quantity = public.inventory.quantity - qty,
            updated_at = now();

    elsif new.type = 'CUSTOMER_RETURN' then
        insert into public.inventory (user_id, name, quantity, unit)
        values (uid, item_name, qty, coalesce(item_unit, 'units'))
        on conflict (user_id, (lower(name))) do update set
            quantity = public.inventory.quantity + qty,
            updated_at = now();

    elsif new.type = 'ADJUSTED' then
        insert into public.inventory (user_id, name, quantity, unit)
        values (uid, item_name, delta, coalesce(item_unit, 'units'))
        on conflict (user_id, (lower(name))) do update set
            quantity = public.inventory.quantity + delta,
            updated_at = now();

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
                        where user_id = uid and lower(name) = lower(original_name);
                    elsif original.type in ('SOLD', 'WRITE_OFF', 'VENDOR_RETURN') then
                        update public.inventory set
                            quantity = quantity + original_qty,
                            updated_at = now()
                        where user_id = uid and lower(name) = lower(original_name);
                    elsif original.type = 'ADJUSTED' then
                        update public.inventory set
                            quantity = quantity - coalesce(nullif(original.payload->>'delta', '')::numeric, 0),
                            updated_at = now()
                        where user_id = uid and lower(name) = lower(original_name);
                    end if;
                end if;
            end if;
        end;
    end if;

    return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Atomic corrections: VOID + replacement in one transaction
-- ---------------------------------------------------------------------------
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

    -- Deterministic ledger id makes the void idempotent
    insert into public.events (user_id, type, payload, ledger_event_id)
    values (uid, 'VOID', jsonb_build_object('voided_event_id', p_voided_event_id), 'void-' || p_voided_event_id::text)
    on conflict (user_id, ledger_event_id) do nothing;

    if p_replacement_type is not null then
        insert into public.events (user_id, type, payload, ledger_event_id)
        values (
            uid,
            p_replacement_type,
            coalesce(p_replacement_payload, '{}'::jsonb),
            'edit-' || p_voided_event_id::text || '-' || encode(gen_random_bytes(6), 'hex')
        );
    end if;

    return true;
end;
$$;

revoke all on function public.apply_correction(uuid, text, jsonb) from public, anon;
grant execute on function public.apply_correction(uuid, text, jsonb) to authenticated;

-- Make new functions/views visible to PostgREST immediately
notify pgrst, 'reload schema';
