-- =====================================================================
-- 0008: chart_baseline_points — per-day historical data points users
-- import to render a trajectory on the cumulative-units chart BEFORE
-- tracked data starts. Independent of the existing baseline summary
-- metrics (totals, ROI cumulatives, etc.): this table is purely for
-- visualization.
--
-- - capper_id IS NULL  → system-level (dashboard chart)
-- - capper_id IS NOT NULL → per-capper (capper page chart)
-- =====================================================================

create table if not exists public.chart_baseline_points (
  id                  uuid primary key default gen_random_uuid(),
  system_id           uuid not null references public.systems(id) on delete cascade,
  capper_id           uuid null references public.cappers(id) on delete cascade,
  date                date not null,
  cumulative_units    numeric(14,4) not null,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists chart_bp_system_date_idx
  on public.chart_baseline_points(system_id, date);
create index if not exists chart_bp_capper_date_idx
  on public.chart_baseline_points(capper_id, date) where capper_id is not null;

drop trigger if exists chart_bp_touch on public.chart_baseline_points;
create trigger chart_bp_touch
  before update on public.chart_baseline_points
  for each row execute procedure public.touch_updated_at();
