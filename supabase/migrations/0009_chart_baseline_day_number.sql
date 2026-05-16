-- =====================================================================
-- 0009: chart_baseline_points uses sequential day_number (integer) on
-- the X-axis instead of calendar dates. Tracked data picks up at the
-- next day after the highest imported day_number.
--
-- Per user spec, existing rows (date-keyed) are cleared.
-- =====================================================================

drop table if exists public.chart_baseline_points cascade;

create table public.chart_baseline_points (
  id                  uuid primary key default gen_random_uuid(),
  system_id           uuid not null references public.systems(id) on delete cascade,
  capper_id           uuid null references public.cappers(id) on delete cascade,
  day_number          integer not null check (day_number >= 1),
  cumulative_units    numeric(14,4) not null,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index chart_bp_system_day_idx
  on public.chart_baseline_points(system_id, day_number);
create index chart_bp_capper_day_idx
  on public.chart_baseline_points(capper_id, day_number)
  where capper_id is not null;

drop trigger if exists chart_bp_touch on public.chart_baseline_points;
create trigger chart_bp_touch
  before update on public.chart_baseline_points
  for each row execute procedure public.touch_updated_at();
