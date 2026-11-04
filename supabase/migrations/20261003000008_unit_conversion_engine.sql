-- M0.8 Unit conversion engine: registry table, inventory base-unit columns,
-- and conversion helpers. Seeded in 009; the trigger is rewritten in 010.
--
-- Golden rule: inventory.quantity is ALWAYS stored in the row's base_unit
-- (kg | l | pcs | m). Cross-dimension conversion is refused without SKU density.

create table if not exists public.unit_registry (
    code text primary key,
    name text not null,
    vernacular_name text,
    category text not null check (category in ('MASS', 'VOLUME', 'COUNT', 'LENGTH')),
    base_unit text not null check (base_unit in ('kg', 'l', 'pcs', 'm')),
    conversion_factor numeric not null check (conversion_factor > 0),
    aliases text[] not null default '{}',
    is_fixed boolean not null default true,
    source text not null default 'seed' check (source in ('seed', 'ai')),
    created_at timestamptz not null default now()
);

create index if not exists unit_registry_aliases_idx on public.unit_registry using gin (aliases);
create index if not exists unit_registry_base_unit_idx on public.unit_registry (base_unit);

alter table public.unit_registry enable row level security;

drop policy if exists "unit_registry_read" on public.unit_registry;
create policy "unit_registry_read" on public.unit_registry
    for select to authenticated
    using (true);

grant select on public.unit_registry to authenticated;

-- Multi-unit support on inventory
alter table public.inventory add column if not exists base_unit text not null default 'pcs';
alter table public.inventory add column if not exists secondary_unit text;
alter table public.inventory add column if not exists conversion_factor numeric;

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'inventory_base_unit_check' and conrelid = 'public.inventory'::regclass
    ) then
        alter table public.inventory
            add constraint inventory_base_unit_check check (base_unit in ('kg', 'l', 'pcs', 'm'));
    end if;
    if not exists (
        select 1 from pg_constraint
        where conname = 'inventory_conversion_factor_check' and conrelid = 'public.inventory'::regclass
    ) then
        alter table public.inventory
            add constraint inventory_conversion_factor_check check (conversion_factor is null or conversion_factor > 0);
    end if;
end $$;

-- ---------------------------------------------------------------------------
-- Registry lookup helpers
-- ---------------------------------------------------------------------------

-- Base unit for a spoken unit, or null when unknown.
create or replace function public.resolve_unit_base(p_input_unit text)
returns text
language sql
stable
security invoker
set search_path = public
as $$
    select r.base_unit
    from public.unit_registry r
    where lower(r.code) = lower(trim(p_input_unit))
       or exists (
            select 1 from unnest(r.aliases) a
            where lower(a) = lower(trim(p_input_unit))
       )
    limit 1;
$$;

-- Converts a quantity into the target base unit.
--   1. input already equals the base unit            -> unchanged
--   2. input equals the SKU's custom secondary unit  -> qty * custom factor
--   3. input is in the registry                      -> qty * registry factor
--   4. unknown, or a cross-dimension unit            -> raw qty (graceful fallback)
create or replace function public.convert_to_base_unit(
    p_qty numeric,
    p_input_unit text,
    p_base_unit text,
    p_secondary_unit text,
    p_custom_factor numeric
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

    if v_secondary is not null and v_unit = v_secondary
        and p_custom_factor is not null and p_custom_factor > 0 then
        return p_qty * p_custom_factor;
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

grant execute on function public.resolve_unit_base(text) to authenticated;
grant execute on function public.convert_to_base_unit(numeric, text, text, text, numeric) to authenticated;

notify pgrst, 'reload schema';
