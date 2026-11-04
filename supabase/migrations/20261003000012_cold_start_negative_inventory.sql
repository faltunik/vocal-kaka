-- ============================================================================
-- M0.12 Cold-Start Unstocked Sales & Negative Inventory Margin Handling
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Add Category Column to Inventory Table
-- ----------------------------------------------------------------------------
alter table public.inventory
    add column if not exists category text not null default 'GENERAL'
    check (category in ('FMCG', 'STAPLES', 'DAIRY_BAKERY', 'GENERAL'));

create index if not exists inventory_category_idx on public.inventory (category);

-- ----------------------------------------------------------------------------
-- 2. Intelligent Product Category Classifier
-- ----------------------------------------------------------------------------
create or replace function public.classify_product_category(
    p_name text,
    p_unit text default null
)
returns text
language plpgsql
immutable
security invoker
as $$
declare
    v_norm text := lower(coalesce(trim(p_name), ''));
    v_unit text := lower(coalesce(trim(p_unit), ''));
begin
    -- 1. Packaged FMCG (12% margin) - Checked first so packaged items with dairy/staple flavors (e.g. Butter Cookies, Milk Biscuits, Egg Noodles) are categorized as FMCG
    if v_norm ~* '(maggi|biscuit|biscuits|cookie|cookies|parle|good day|marie|chips|lays|kurkure|soap|sabun|shampoo|paste|toothpaste|colgate|close up|noodle|noodles|chai|tea|patti|coffee|namkeen|bhujia|sev|chocolate|cadbury|dairy milk|kitkat|detergent|surf|rin|tide|ariel|vim|harpic|dove|lux|dettol|oreo|marigold)' then
        return 'FMCG';
    end if;

    -- 2. Dairy & Bakery (8% margin)
    if v_norm ~* '(milk|doodh|dudh|bread|pav|dahi|curd|paneer|butter|makkhan|makhan|egg|anda|ande|lassi|chaas|buttermilk|bun|rusk|rusks|amul|mother dairy|nandini|harvest gold|britannia bread|modern|english oven|bakery)' then
        return 'DAIRY_BAKERY';
    end if;

    -- 3. Staples & Loose Commodities (6% margin)
    if v_norm ~* '(sugar|cheeni|chini|rice|chawal|atta|aata|flour|maida|sooji|suji|besan|dal|daal|toor|arhar|moong|chana|urad|masoor|oil|tel|sarson|mustard|jeera|cumin|haldi|turmeric|mirch|chilli|namak|salt|ghee|hing|dhaniya|poha|wheat|pulse|pulses)'
       or v_unit in ('kg', 'g', 'gram', 'grams', 'l', 'ml', 'litre', 'liter', 'litres', 'liters') then
        return 'STAPLES';
    end if;

    -- 4. Default Store Benchmark (10% margin)
    return 'GENERAL';
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Category Benchmark Margin Lookup Helper
-- ----------------------------------------------------------------------------
create or replace function public.get_category_default_margin(p_category text)
returns numeric
language sql
immutable
as $$
    select case upper(coalesce(p_category, 'GENERAL'))
        when 'FMCG' then 0.12        -- 12% margin
        when 'STAPLES' then 0.06     -- 6% margin
        when 'DAIRY_BAKERY' then 0.08 -- 8% margin
        else 0.10                    -- 10% general fallback
    end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Estimated Cost Price Helper
-- ----------------------------------------------------------------------------
create or replace function public.estimate_cost_price(
    p_selling_price numeric,
    p_category text
)
returns numeric
language sql
immutable
as $$
    select case
        when p_selling_price is null or p_selling_price <= 0 then 0
        else round(p_selling_price * (1.0 - public.get_category_default_margin(p_category)), 2)
    end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Updated Upsert Inventory Movement (Cold-Start & Negative Stock Aware)
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
    v_base text;
    v_secondary text;
    v_factor numeric;
    v_normalized numeric;
    v_category text;
    v_existing_cost numeric;
begin
    -- Check existing SKU metadata
    select base_unit, secondary_unit, conversion_factor, category, last_purchase_price
      into v_base, v_secondary, v_factor, v_category, v_existing_cost
      from public.inventory
     where user_id = p_user and lower(name) = lower(p_name);

    -- Cold-Start: If product is completely new, infer category & canonical base unit
    if v_category is null then
        v_category := public.classify_product_category(p_name, p_unit);
    end if;

    if v_base is null then
        v_base := coalesce(public.resolve_unit_base(p_unit), 
            case 
                when v_category = 'STAPLES' and lower(coalesce(p_unit, '')) in ('l', 'ml', 'liter', 'litre', 'oil') then 'l'
                when v_category = 'STAPLES' then 'kg'
                when v_category = 'DAIRY_BAKERY' and lower(coalesce(p_unit, '')) in ('l', 'ml', 'liter', 'litre') then 'l'
                else 'pcs'
            end
        );
    end if;

    -- Convert signed quantity to SKU base unit
    v_normalized := public.convert_to_base_unit(p_signed_qty, p_unit, v_base, v_secondary, v_factor);

    -- Materialize movement: Cold-start sales create negative balances seamlessly
    insert into public.inventory (
        user_id,
        product_id,
        name,
        quantity,
        unit,
        base_unit,
        secondary_unit,
        conversion_factor,
        category
    )
    values (
        p_user,
        p_product_id,
        p_name,
        v_normalized,
        v_base,
        v_base,
        v_secondary,
        v_factor,
        v_category
    )
    on conflict (user_id, (lower(name))) do update set
        quantity = public.inventory.quantity + excluded.quantity,
        product_id = coalesce(public.inventory.product_id, excluded.product_id),
        category = case when public.inventory.category = 'GENERAL' and excluded.category != 'GENERAL' then excluded.category else public.inventory.category end,
        updated_at = now();

    -- Price updates: Update selling price or wholesale purchase cost
    if p_price is not null and p_price > 0 then
        if p_price_kind = 'COST' then
            update public.inventory 
            set last_purchase_price = p_price, 
                updated_at = now()
            where user_id = p_user and lower(name) = lower(p_name);
        elsif p_price_kind = 'SELL' then
            update public.inventory 
            set selling_price = p_price, 
                updated_at = now()
            where user_id = p_user and lower(name) = lower(p_name);
        end if;
    end if;
end;
$$;

revoke all on function public.upsert_inventory_movement(uuid, text, text, numeric, numeric, text, text) from public, anon, authenticated;

-- Backfill categories on existing rows where category is GENERAL
update public.inventory
set category = public.classify_product_category(name, unit)
where category = 'GENERAL';

notify pgrst, 'reload schema';
