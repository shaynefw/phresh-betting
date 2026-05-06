-- =====================================================================
-- 0004: system_baselines — system-wide pre-app residual offset.
-- One row per system. Holds totals NOT covered by per-capper baselines
-- (e.g. paper history from cappers that have since been deleted).
--
-- Combined dashboard math:
--   combined = system_baseline + sum(capper_baselines) + journal
--
-- Skips current-streak fields by design: at the system level "current
-- streak" is a temporal property of live data, not a baseline value.
-- =====================================================================

create table if not exists public.system_baselines (
  system_id                  uuid primary key references public.systems(id) on delete cascade,

  total_betting_days         integer       not null default 0,
  total_bets                 integer       not null default 0,
  total_risk                 numeric(14,2) not null default 0,
  cumulative_amount_pnl      numeric(14,2) not null default 0,
  cumulative_units_pnl       numeric(14,4) not null default 0,
  wins                       integer       not null default 0,
  losses                     integer       not null default 0,

  green_day_count            integer       not null default 0,
  red_day_count              integer       not null default 0,
  green_day_roi_cumulative   numeric(14,4) not null default 0,
  red_day_roi_cumulative     numeric(14,4) not null default 0,

  running_roi_percent        numeric(10,4) not null default 0,
  win_rate_percent           numeric(10,4) not null default 0,
  green_day_avg_roi          numeric(10,4) not null default 0,
  red_day_avg_roi            numeric(10,4) not null default 0,
  green_day_probability      numeric(10,4) not null default 0,

  max_win_streak             integer not null default 0,
  max_loss_streak            integer not null default 0,

  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists system_baselines_touch on public.system_baselines;
create trigger system_baselines_touch
  before update on public.system_baselines
  for each row execute procedure public.touch_updated_at();
