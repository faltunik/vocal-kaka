-- ============================================================================
-- Migration: 20261004000027_repair_cross_dimension_units.sql
-- Description: Pre-fix barcode auto-catalog rows stored the OpenFoodFacts unit
--              (e.g. 'g'/'ml') while base_unit defaulted to 'pcs'. Events
--              emitted with the mismatched unit were silently skipped by the
--              cross-dimension guard, so stock never materialized and history
--              split into g/pcs rows. Repair those rows by adopting the unit's
--              registry dimension as the SKU base (g -> kg, ml -> l).
--              Rows with legitimate packaging labels (packet/bottle/dozen on a
--              pcs base) are untouched: their unit already resolves to pcs.
-- ============================================================================

update public.inventory i
   set base_unit = public.resolve_unit_base(i.unit),
       unit = public.resolve_unit_base(i.unit),
       updated_at = now()
 where i.base_unit is not null
   and public.resolve_unit_base(i.unit) is not null
   and public.resolve_unit_base(i.unit) <> i.base_unit;

notify pgrst, 'reload schema';
