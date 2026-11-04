-- ============================================================================
-- Migration: 20261004000025_prune_dead_schema.sql
-- Description: Master-spec retention benchmark: remove schema objects with no
--              production call sites.
--   1. product_definitions — legacy user-scoped catalog table, superseded by
--      public.inventory (migration 013); zero client/edge/trigger references.
--   2. estimate_cost_price — helper never called by any migration, trigger,
--      edge function or client (cost estimation lives in the edge/dashboard).
-- ============================================================================

drop table if exists public.product_definitions cascade;
drop function if exists public.estimate_cost_price(numeric, text);

notify pgrst, 'reload schema';
