-- Migration 013: Master Catalog Schema Extensions
-- Add category flexibility, aliases, and trigram search indices for master catalog lookups.

-- 1. Category Column and Extended Constraint
alter table public.inventory
    add column if not exists category text not null default 'FMCG';

alter table public.inventory
    drop constraint if exists inventory_category_check;

alter table public.inventory
    add constraint inventory_category_check check (
        upper(category) in (
            'FMCG', 'STAPLES', 'DAIRY_BAKERY', 'DAIRY', 'SPICES', 
            'GENERAL', 'LOOSE_GRAINS', 'EDIBLE_OIL', 'OTHER'
        )
    );

-- 2. Vernacular & Hindi Aliases
alter table public.inventory
    add column if not exists aliases text[] not null default '{}';

-- 3. High-Performance Trigram & Search Indices
create extension if not exists pg_trgm;

create index if not exists inventory_user_category_idx 
    on public.inventory (user_id, category);

create index if not exists inventory_user_name_trgm_idx 
    on public.inventory using gin (name gin_trgm_ops);

create index if not exists inventory_user_aliases_gin_idx 
    on public.inventory using gin (aliases);
