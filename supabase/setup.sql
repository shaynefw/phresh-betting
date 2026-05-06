-- =====================================================================
-- Phresh Mastery — single-paste setup for Clerk + Supabase Postgres
-- Paste this into Supabase Dashboard → SQL Editor → Run.
-- =====================================================================

create extension if not exists "pgcrypto";

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ---------- systems ----------
create table if not exists public.systems (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null,
  name        text not null,
  description text,
  notes       text,
  archived    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists systems_user_idx on public.systems(user_id);
drop trigger if exists systems_touch on public.systems;
create trigger systems_touch before update on public.systems
  for each row execute procedure public.touch_updated_at();

-- ---------- scaling log ----------
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

-- ---------- cappers ----------
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
drop trigger if exists cappers_touch on public.cappers;
create trigger cappers_touch before update on public.cappers
  for each row execute procedure public.touch_updated_at();

-- ---------- capper day entries ----------
create table if not exists public.capper_day_entries (
  id                         uuid primary key default gen_random_uuid(),
  capper_id                  uuid not null references public.cappers(id) on delete cascade,
  system_id                  uuid not null references public.systems(id) on delete cascade,
  date                       date not null,
  entry_mode                 text not null default 'daily_totals'
                             check (entry_mode in ('daily_totals','bet_level')),
  wager_total                numeric(14,2) not null default 0,
  bet_count                  integer not null default 0,
  daily_amount_pnl           numeric(14,2) not null default 0,
  wins                       integer not null default 0,
  losses                     integer not null default 0,
  unit_size_used             numeric(12,2),
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
drop trigger if exists cde_touch on public.capper_day_entries;
create trigger cde_touch before update on public.capper_day_entries
  for each row execute procedure public.touch_updated_at();

-- ---------- bet-level entries ----------
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
drop trigger if exists cbe_touch on public.capper_bet_entries;
create trigger cbe_touch before update on public.capper_bet_entries
  for each row execute procedure public.touch_updated_at();

-- ---------- journal ----------
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
drop trigger if exists jde_touch on public.journal_day_entries;
create trigger jde_touch before update on public.journal_day_entries
  for each row execute procedure public.touch_updated_at();

-- ---------- backups ----------
create table if not exists public.system_backups (
  id          uuid primary key default gen_random_uuid(),
  system_id   uuid not null references public.systems(id) on delete cascade,
  user_id     text not null,
  label       text,
  payload     jsonb not null,
  created_at  timestamptz not null default now()
);
create index if not exists sb_system_idx on public.system_backups(system_id);

-- =====================================================================
-- RECOMPUTE FUNCTIONS + TRIGGERS
-- =====================================================================

create or replace function public.active_unit_size(_system_id uuid, _on date)
returns numeric language sql stable as $$
  select unit_size_dollars
    from public.scaling_log_entries
   where system_id = _system_id and effective_date <= _on
   order by effective_date desc, created_at desc
   limit 1;
$$;

create or replace function public.recompute_capper(_capper_id uuid)
returns void language plpgsql as $$
declare
  d record; cum_amt numeric := 0; cum_units numeric := 0; cum_wager numeric := 0;
  rec_w integer := 0; rec_l integer := 0;
  streak_val integer := 0; streak_type text := 'neutral_hold';
  max_win integer := 0; max_loss integer := 0;
  bet_w integer; bet_l integer; bet_v integer;
  sum_wager numeric; sum_pnl numeric; bet_count integer;
  unit_size numeric; daily_units numeric; daily_roi numeric;
  win_rate numeric; running_roi numeric; sysid uuid;
begin
  select system_id into sysid from public.cappers where id = _capper_id;
  if sysid is null then return; end if;
  for d in select * from public.capper_day_entries where capper_id = _capper_id order by date asc, created_at asc loop
    if d.entry_mode = 'bet_level' then
      select coalesce(sum(wager_amount) filter (where bet_result <> 'void'),0),
             coalesce(sum(amount_pnl)   filter (where bet_result <> 'void'),0),
             coalesce(count(*)          filter (where bet_result <> 'void'),0),
             coalesce(count(*)          filter (where bet_result = 'win'),0),
             coalesce(count(*)          filter (where bet_result = 'loss'),0),
             coalesce(count(*)          filter (where bet_result = 'void'),0)
      into sum_wager, sum_pnl, bet_count, bet_w, bet_l, bet_v
      from public.capper_bet_entries where capper_day_entry_id = d.id;
    else
      sum_wager := d.wager_total; sum_pnl := d.daily_amount_pnl;
      bet_count := d.bet_count; bet_w := d.wins; bet_l := d.losses;
    end if;
    unit_size := coalesce(d.unit_size_used, public.active_unit_size(d.system_id, d.date), 1);
    if unit_size = 0 then unit_size := 1; end if;
    daily_units := case when unit_size = 0 then 0 else sum_pnl / unit_size end;
    daily_roi   := case when sum_wager = 0 then 0 else (sum_pnl / sum_wager) * 100 end;
    cum_amt := cum_amt + sum_pnl;  cum_units := cum_units + daily_units;
    cum_wager := cum_wager + sum_wager; rec_w := rec_w + bet_w; rec_l := rec_l + bet_l;
    win_rate := case when (bet_w + bet_l) = 0 then 0 else (bet_w::numeric / (bet_w + bet_l)) * 100 end;
    running_roi := case when cum_wager = 0 then 0 else (cum_amt / cum_wager) * 100 end;
    if daily_roi > 0 then
      if streak_type = 'green' then streak_val := streak_val + 1; else streak_val := 1; end if;
      streak_type := 'green';
      if streak_val > max_win then max_win := streak_val; end if;
    elsif daily_roi < 0 then
      if streak_type = 'red' then streak_val := streak_val + 1; else streak_val := 1; end if;
      streak_type := 'red';
      if streak_val > max_loss then max_loss := streak_val; end if;
    end if;
    update public.capper_day_entries set
      wager_total = sum_wager, bet_count = bet_count, daily_amount_pnl = sum_pnl,
      wins = bet_w, losses = bet_l, unit_size_used = unit_size,
      daily_units_pnl = daily_units, daily_roi_percent = daily_roi,
      cumulative_amount_pnl = cum_amt, cumulative_units_pnl = cum_units,
      running_roi_percent = running_roi, win_rate_percent = win_rate,
      record_wins = rec_w, record_losses = rec_l,
      current_streak_value = streak_val, current_streak_type = streak_type,
      max_win_streak = max_win, max_loss_streak = max_loss
    where id = d.id;
  end loop;
end $$;

create or replace function public.recompute_journal(_system_id uuid)
returns void language plpgsql as $$
declare
  d record; cum_amt numeric := 0; cum_units numeric := 0; cum_wager numeric := 0;
  rec_w integer := 0; rec_l integer := 0;
  streak_val integer := 0; streak_type text := 'neutral_hold';
  max_win integer := 0; max_loss integer := 0;
  green_n integer := 0; red_n integer := 0;
  green_roi_cum numeric := 0; red_roi_cum numeric := 0;
  unit_size numeric; daily_roi numeric; win_rate numeric; running_roi numeric;
begin
  delete from public.journal_day_entries where system_id = _system_id;
  for d in
    select date, sum(wager_total) as total_wager, sum(bet_count) as total_bets,
           sum(daily_amount_pnl) as daily_amount_pnl, sum(daily_units_pnl) as daily_units_pnl,
           sum(wins) as wins, sum(losses) as losses
    from public.capper_day_entries where system_id = _system_id
    group by date order by date asc
  loop
    unit_size := public.active_unit_size(_system_id, d.date);
    cum_amt := cum_amt + d.daily_amount_pnl;
    cum_units := cum_units + d.daily_units_pnl;
    cum_wager := cum_wager + d.total_wager;
    rec_w := rec_w + d.wins; rec_l := rec_l + d.losses;
    daily_roi := case when d.total_wager = 0 then 0 else (d.daily_amount_pnl / d.total_wager) * 100 end;
    running_roi := case when cum_wager = 0 then 0 else (cum_amt / cum_wager) * 100 end;
    win_rate := case when (d.wins + d.losses) = 0 then 0 else (d.wins::numeric / (d.wins + d.losses)) * 100 end;
    if daily_roi > 0 then
      green_n := green_n + 1; green_roi_cum := green_roi_cum + daily_roi;
      if streak_type = 'green' then streak_val := streak_val + 1; else streak_val := 1; end if;
      streak_type := 'green';
      if streak_val > max_win then max_win := streak_val; end if;
    elsif daily_roi < 0 then
      red_n := red_n + 1; red_roi_cum := red_roi_cum + daily_roi;
      if streak_type = 'red' then streak_val := streak_val + 1; else streak_val := 1; end if;
      streak_type := 'red';
      if streak_val > max_loss then max_loss := streak_val; end if;
    end if;
    insert into public.journal_day_entries (
      system_id, date, total_wager, total_bets, total_system_risk_cumulative,
      daily_amount_pnl, cumulative_amount_pnl, daily_units_pnl, cumulative_units_pnl,
      daily_roi_percent, running_roi_percent, wins, losses, win_rate_percent,
      record_wins, record_losses, green_day_count, red_day_count,
      green_day_roi_cumulative, red_day_roi_cumulative, green_day_avg_roi, red_day_avg_roi,
      green_day_probability, current_streak_value, current_streak_type,
      max_win_streak, max_loss_streak, unit_size_used
    ) values (
      _system_id, d.date, d.total_wager, d.total_bets, cum_wager,
      d.daily_amount_pnl, cum_amt, d.daily_units_pnl, cum_units,
      daily_roi, running_roi, d.wins, d.losses, win_rate,
      rec_w, rec_l, green_n, red_n, green_roi_cum, red_roi_cum,
      case when green_n = 0 then 0 else green_roi_cum / green_n end,
      case when red_n = 0 then 0 else red_roi_cum / red_n end,
      case when (green_n + red_n) = 0 then 0 else (green_n::numeric / (green_n + red_n)) * 100 end,
      streak_val, streak_type, max_win, max_loss, unit_size);
  end loop;
end $$;

create or replace function public.trg_after_cde() returns trigger language plpgsql as $$
declare v_capper uuid; v_system uuid;
begin
  v_capper := coalesce(new.capper_id, old.capper_id);
  v_system := coalesce(new.system_id, old.system_id);
  perform public.recompute_capper(v_capper);
  perform public.recompute_journal(v_system);
  return null;
end $$;
drop trigger if exists cde_after on public.capper_day_entries;
create trigger cde_after after insert or update or delete on public.capper_day_entries
  for each row execute procedure public.trg_after_cde();

create or replace function public.trg_after_cbe() returns trigger language plpgsql as $$
declare v_capper uuid; v_system uuid;
begin
  v_capper := coalesce(new.capper_id, old.capper_id);
  v_system := coalesce(new.system_id, old.system_id);
  perform public.recompute_capper(v_capper);
  perform public.recompute_journal(v_system);
  return null;
end $$;
drop trigger if exists cbe_after on public.capper_bet_entries;
create trigger cbe_after after insert or update or delete on public.capper_bet_entries
  for each row execute procedure public.trg_after_cbe();

create or replace function public.trg_after_scaling() returns trigger language plpgsql as $$
declare c record; v_system uuid;
begin
  v_system := coalesce(new.system_id, old.system_id);
  for c in select id from public.cappers where system_id = v_system loop
    perform public.recompute_capper(c.id);
  end loop;
  perform public.recompute_journal(v_system);
  return null;
end $$;
drop trigger if exists scaling_after on public.scaling_log_entries;
create trigger scaling_after after insert or update or delete on public.scaling_log_entries
  for each row execute procedure public.trg_after_scaling();
