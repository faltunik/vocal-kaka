-- ============================================================================
-- Migration: 20261003000020_inventory_category_enum.sql
-- Description: The catalog forms write user-facing category labels
--              ("Staples", "Dairy", "Spices"), but the inventory check
--              constraint only allowed ('FMCG','STAPLES','DAIRY_BAKERY',
--              'GENERAL'). Product creation/update with any other category
--              failed with a constraint violation. Widen the allowed enum and
--              keep client values canonical (utils/categories.ts).
-- ============================================================================

alter table public.inventory drop constraint if exists inventory_category_check;

alter table public.inventory add constraint inventory_category_check
    check (category in (
        'FMCG',
        'STAPLES',
        'DAIRY_BAKERY',
        'GENERAL',
        'SPICES',
        'LOOSE_GRAINS',
        'EDIBLE_OIL',
        'DAIRY'
    ));

notify pgrst, 'reload schema';
