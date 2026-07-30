-- =====================================================================
-- Per-level baseline units for bankroll positioning.
--
-- Each scaling level has a "baseline units" mark — the cumulative-units
-- position considered even for that level's baseline bankroll. Current
-- bankroll = baseline bankroll + (current cumulative units − baseline
-- units) × unit size. When null, the app falls back to the row's
-- starting_units_threshold (the band floor).
-- =====================================================================

alter table public.scaling_log_entries
  add column if not exists baseline_units numeric(12,2);
