-- =====================================================================
-- 0005: store an optional historical streak breakdown on each baseline.
-- Format: jsonb array of {"type": "green"|"red", "length": int, "count": int}
-- These are merged with tracked streak runs at render time.
-- =====================================================================

alter table public.capper_baselines
  add column if not exists streak_breakdown jsonb not null default '[]'::jsonb;

alter table public.system_baselines
  add column if not exists streak_breakdown jsonb not null default '[]'::jsonb;
