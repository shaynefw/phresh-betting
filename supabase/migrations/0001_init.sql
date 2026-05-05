-- =====================================================================
-- Phresh Mastery Betting System — initial schema
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------- helpers --------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------- systems --------------------------------------------------
create table if not exists public.systems (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  description text,
  notes       text,
  archived    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists systems_user_idx on public.systems(user_id);
create trigger systems_touch before update on public.systems
  for each row execute procedure public.touch_updated_at();

-- ---------- scaling log ----------------------------------------------
-- A row defines: starting at `effective_date`, the system's unit size becomes `unit_size_dollars`.
-- The `starting_units_threshold` / `ending_units_threshold` document the band that triggered it.
create table if not exists public.scaling_log_entries (
  id                          uuid primary key default gen_random_uuid(),
  system_id                   uuid not null references public.systems(id) on delete cascade,
  effective_date              date not null,
  starting_units_threshold    numeric(12,2),
  ending_units_threshold      numeric(12,2),
  unit_size_dollars           numeric(12,2) not null,
  bankroll                    numeric(14,2),
  notes                       text,
  created_at                  timestamptz not null default now()
);
create index if not exists scaling_log_system_date_idx
  on public.scaling_log_entries(system_id, effective_date);

-- ---------- cappers --------------------------------------------------
create table if not exists public.cappers (
  id                       uuid primary key default gen_random_uuid(),
  system_id                uuid not null references public.systems(id) on delete cascade,
  name                     text not null,
  base_system_risk_units   numeric(8,2) not null default 1,
  is_active                boolean not null default true,
  is_archived              boolean not null default false,
  current_phase            text not null default 'lukewarm'
                           check (current_phase in ('heater','lukewarm','cold')),
  checklist_status         text not null default 'started'
                           check (checklist_status in ('started','complete')),
  sort_order               integer not null default 0,
  notes                    text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index if not exists cappers_system_idx on public.cappers(system_id);
create trigger cappers_touch before update on public.cappers
  for each row execute procedure public.touch_updated_at();

-- ---------- capper day entries --------------------------------------
create table if not exists public.capper_day_entries (
  id                         uuid primary key default gen_random_uuid(),
  capper_id                  uuid not null references public.cappers(id) on delete cascade,
  system_id                  uuid not null references public.systems(id) on delete cascade,
  date                       date not null,
  entry_mode                 text not null default 'daily_totals'
                             check (entry_mode in ('daily_totals','bet_level')),
  -- raw inputs / aggregated
  wager_total                numeric(14,2) not null default 0,
  bet_count                  integer not null default 0,
  daily_amount_pnl           numeric(14,2) not null default 0,
  wins                       integer not null default 0,
  losses                     integer not null default 0,
  -- snapshot of unit size used for this day
  unit_size_used             numeric(12,2),
  -- derived (computed by recompute fn)
  daily_units_pnl            numeric(14,4) not null default 0,
  daily_roi_percent          numeric(10,4) not null default 0,
  cumulative_amount_pnl      numeric(14,2) not null default 0,
  cumulative_units_pnl       numeric(14,4) not null default 0,
  running_roi_percent        numeric(10,4) not null default 0,
  win_rate_percent           numeric(10,4) not null default 0,
  record_wins                integer not null default 0,
  record_losses              integer not null default 0,
  current_streak_value       integer not null default 0,
  current_streak_type        text not null default 'neutral_hold'
                             check (current_streak_type in ('green','red','neutral_hold')),
  max_win_streak             integer not null default 0,
  max_loss_streak            integer not null default 0,
  is_complete                boolean not null default true,
  notes                      text,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  unique (capper_id, date)
);
create index if not exists cde_system_date_idx on public.capper_day_entries(system_id, date);
create index if not exists cde_capper_date_idx on public.capper_day_entries(capper_id, date);
create trigger cde_touch before update on public.capper_day_entries
  for each row execute procedure public.touch_updated_at();

-- ---------- bet-level entries ---------------------------------------
create table if not exists public.capper_bet_entries (
  id                       uuid primary key default gen_random_uuid(),
  capper_day_entry_id      uuid not null references public.capper_day_entries(id) on delete cascade,
  capper_id                uuid not null references public.cappers(id) on delete cascade,
  system_id                uuid not null references public.systems(id) on delete cascade,
  date                     date not null,
  wager_amount             numeric(14,2) not null default 0,
  odds                     numeric(10,2),
  bet_result               text not null default 'win'
                           check (bet_result in ('win','loss','void')),
  amount_pnl               numeric(14,2) not null default 0,
  units_risk_multiplier    numeric(8,4),
  notes                    text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index if not exists cbe_day_idx on public.capper_bet_entries(capper_day_entry_id);
create trigger cbe_touch before update on public.capper_bet_entries
  for each row execute procedure public.touch_updated_at();

-- ---------- journal day entries -------------------------------------
create table if not exists public.journal_day_entries (
  id                              uuid primary key default gen_random_uuid(),
  system_id                       uuid not null references public.systems(id) on delete cascade,
  date                            date not null,
  total_wager                     numeric(14,2) not null default 0,
  total_bets                      integer not null default 0,
  total_system_risk_cumulative    numeric(14,2) not null default 0,
  daily_amount_pnl                numeric(14,2) not null default 0,
  cumulative_amount_pnl           numeric(14,2) not null default 0,
  daily_units_pnl                 numeric(14,4) not null default 0,
  cumulative_units_pnl            numeric(14,4) not null default 0,
  daily_roi_percent               numeric(10,4) not null default 0,
  running_roi_percent             numeric(10,4) not null default 0,
  wins                            integer not null default 0,
  losses                          integer not null default 0,
  win_rate_percent                numeric(10,4) not null default 0,
  record_wins                     integer not null default 0,
  record_losses                   integer not null default 0,
  green_day_count                 integer not null default 0,
  red_day_count                   integer not null default 0,
  green_day_roi_cumulative        numeric(14,4) not null default 0,
  red_day_roi_cumulative          numeric(14,4) not null default 0,
  green_day_avg_roi               numeric(10,4) not null default 0,
  red_day_avg_roi                 numeric(10,4) not null default 0,
  green_day_probability           numeric(10,4) not null default 0,
  current_streak_value            integer not null default 0,
  current_streak_type             text not null default 'neutral_hold'
                                  check (current_streak_type in ('green','red','neutral_hold')),
  max_win_streak                  integer not null default 0,
  max_loss_streak                 integer not null default 0,
  unit_size_used                  numeric(12,2),
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),
  unique (system_id, date)
);
create index if not exists jde_system_date_idx on public.journal_day_entries(system_id, date);
create trigger jde_touch before update on public.journal_day_entries
  for each row execute procedure public.touch_updated_at();

-- ---------- backups --------------------------------------------------
create table if not exists public.system_backups (
  id          uuid primary key default gen_random_uuid(),
  system_id   uuid not null references public.systems(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  label       text,
  payload     jsonb not null,
  created_at  timestamptz not null default now()
);
create index if not exists sb_system_idx on public.system_backups(system_id);

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================
alter table public.systems              enable row level security;
alter table public.scaling_log_entries  enable row level security;
alter table public.cappers              enable row level security;
alter table public.capper_day_entries   enable row level security;
alter table public.capper_bet_entries   enable row level security;
alter table public.journal_day_entries  enable row level security;
alter table public.system_backups       enable row level security;

-- systems: only owner
drop policy if exists "systems owner" on public.systems;
create policy "systems owner" on public.systems
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- helper: row belongs to a system the caller owns
create or replace function public.is_system_owner(_system_id uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.systems s
    where s.id = _system_id and s.user_id = auth.uid()
  );
$$;

-- generic policy template
do $$
declare t text;
begin
  for t in select unnest(array[
    'scaling_log_entries','cappers','capper_day_entries',
    'capper_bet_entries','journal_day_entries','system_backups'
  ]) loop
    execute format('drop policy if exists "via system" on public.%I', t);
    execute format(
      'create policy "via system" on public.%I for all
         using  (public.is_system_owner(system_id))
         with check (public.is_system_owner(system_id))',
      t);
  end loop;
end $$;
