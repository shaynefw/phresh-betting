-- =====================================================================
-- 0012_bet_sport.sql
--
-- Adds a nullable Sport tag to capper_bet_entries.
--
-- Foundational data layer for future per-sport metric analysis. We deliberately
-- omit a CHECK constraint so that adding a new sport to the UI later does NOT
-- require a schema migration — the SportSelect dropdown is the single source
-- of truth for the supported set, and the column accepts anything for storage.
--
-- Legacy behavior: every pre-existing bet stays NULL. The bet-edit form
-- shows the Sport dropdown as unselected for those rows until the user
-- chooses a value (retroactive tagging).
--
-- No effect on recompute_capper / recompute_journal / rollups — sport is
-- purely descriptive metadata. Daily totals, units, ROI, scaling, etc.
-- are not derived from it.
-- =====================================================================

alter table public.capper_bet_entries
  add column if not exists sport text;
