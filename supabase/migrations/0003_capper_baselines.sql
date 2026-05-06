-- =====================================================================
-- 0003: capper_baselines — manual historical metrics that get added on
-- top of live tracked data when computing the capper's performance
-- summary. One row per capper. All values are user-entered; the app
-- recomputes ratios at render time after blending.
-- =====================================================================

create table if not exists public.capper_baselines (
  capper_id                  uuid primary key references public.cappers(id) on delete cascade,
  system_id                  uuid not null references public.systems(id) on delete cascade,

  -- core counters
  total_betting_days         integer       not null default 0,
  total_bets                 integer       not null default 0,
  total_risk                 numeric(14,2) not null default 0,
  cumulative_amount_pnl      numeric(14,2) not null default 0,
  cumulative_units_pnl       numeric(14,4) not null default 0,
  wins                       integer       not null default 0,
  losses                     integer       not null default 0,

  -- daily roll-up counters
  green_day_count            integer       not null default 0,
  red_day_count              integer       not null default 0,
  green_day_roi_cumulative   numeric(14,4) not null default 0,
  red_day_roi_cumulative     numeric(14,4) not null default 0,

  -- pre-computed metrics (user-entered; if blank we'll derive from totals)
  running_roi_percent        numeric(10,4) not null default 0,
  win_rate_percent           numeric(10,4) not null default 0,
  green_day_avg_roi          numeric(10,4) not null default 0,
  red_day_avg_roi            numeric(10,4) not null default 0,
  green_day_probability      numeric(10,4) not null default 0,

  -- streaks at the moment the baseline was captured
  current_streak_value       integer not null default 0,
  current_streak_type        text    not null default 'neutral_hold'
                             check (current_streak_type in ('green','red','neutral_hold')),
  max_win_streak             integer not null default 0,
  max_loss_streak            integer not null default 0,

  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists capper_baselines_system_idx
  on public.capper_baselines(system_id);

drop trigger if exists capper_baselines_touch on public.capper_baselines;
create trigger capper_baselines_touch
  before update on public.capper_baselines
  for each row execute procedure public.touch_updated_at();
