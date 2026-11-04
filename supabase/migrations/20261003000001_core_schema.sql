-- M0.1 Core schema reset (legacy test tables replaced with canonical v1)
-- Tables: product_definitions (catalog), inventory (stock state), events (ledger), voice_command_logs (recording archive)

create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

-- Legacy test schema (safe to drop: no production users)
drop trigger if exists on_new_event on public.events;
drop function if exists public.handle_new_event();
drop table if exists public.events cascade;
drop table if exists public.voice_command_logs cascade;
drop table if exists public.inventory cascade;
drop table if exists public.product_definitions cascade;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

-- Catalog: canonical product identity plus local aliases (Hinglish/Devanagari)
create table public.product_definitions (
    id uuid primary key default uuid_generate_v4(),
    user_id uuid not null references auth.users(id) on delete cascade,
    product_id text not null,
    english_name text not null,
    local_reference_names text[] not null default '{}',
    default_unit text not null default 'units',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, product_id)
);

-- Stock state, materialized from events
create table public.inventory (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    product_id text,
    name text not null,
    quantity numeric not null default 0,
    unit text not null default 'units',
    barcode text,
    last_purchase_price numeric,
    selling_price numeric,
    low_stock_threshold numeric not null default 5,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, name)
);

create index inventory_user_barcode_idx on public.inventory (user_id, barcode) where barcode is not null;
create index inventory_user_product_idx on public.inventory (user_id, product_id) where product_id is not null;

-- Append-only ledger. Corrections are new events (VOID + replacement), never updates.
create table public.events (
    event_id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    type text not null check (type in (
        'PURCHASED',
        'SOLD',
        'ADJUSTED',
        'WRITE_OFF',
        'CUSTOMER_RETURN',
        'VENDOR_RETURN',
        'PRICE_UPDATED',
        'EXPENSE',
        'VOID'
    )),
    payload jsonb not null,
    ledger_event_id text not null,
    created_at timestamptz not null default now(),
    unique (user_id, ledger_event_id)
);

create index events_user_created_idx on public.events (user_id, created_at desc);
create index events_user_type_idx on public.events (user_id, type);

-- Recording archive: one row per voice command, from upload to applied
create table public.voice_command_logs (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    recording_id text not null,
    command_text text,
    language text,
    parsed_intents jsonb,
    audio_path text,
    duration_ms integer,
    status text not null default 'pending' check (status in (
        'pending',
        'uploaded',
        'transcribed',
        'parsed',
        'applied',
        'failed'
    )),
    transcript_provider text,
    parse_provider text,
    prompt_version text,
    error text,
    created_at timestamptz not null default now(),
    processed_at timestamptz,
    unique (user_id, recording_id)
);

create index voice_logs_user_created_idx on public.voice_command_logs (user_id, created_at desc);

create trigger product_definitions_updated_at
    before update on public.product_definitions
    for each row execute function public.set_updated_at();

create trigger inventory_updated_at
    before update on public.inventory
    for each row execute function public.set_updated_at();

-- RLS
alter table public.product_definitions enable row level security;
alter table public.inventory enable row level security;
alter table public.events enable row level security;
alter table public.voice_command_logs enable row level security;

create policy "product_definitions_owner_all" on public.product_definitions
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "inventory_owner_all" on public.inventory
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "events_owner_select" on public.events
    for select using (auth.uid() = user_id);

create policy "events_owner_insert" on public.events
    for insert with check (auth.uid() = user_id);

create policy "voice_logs_owner_all" on public.voice_command_logs
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
