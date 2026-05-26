-- =====================================================================
-- 0013_journal_baseline_days.sql
--
-- Per-date historical baseline rows for the Daily Betting Journal.
--
-- Use case: the user wants to import pre-tracking history (e.g. every
-- day before May 6) so the journal's cumulative columns (Cum $,
-- Cum Units, Run ROI, Streak) flow continuously into the tracked
-- period. After import, the journal recomputes from the earliest
-- baseline date forward.
--
-- This table lives alongside the capper_day_entries source of the
-- existing journal. recompute_journal() now walks a UNION of both,
-- summing same-date overlaps and computing cumulative state in date
-- order. Year and All-Time dashboard views automatically pick up the
-- new rows because they read journal_day_entries by date.
--
-- Idempotent: safe to re-run.
-- =====================================================================

create table if not exists public.journal_baseline_days (
  id                  uuid primary key default gen_random_uuid(),
  system_id           uuid not null references public.systems(id) on delete cascade,
  date                date not null,
  total_wager         numeric(14,2) not null default 0,
  total_bets          integer       not null default 0,
  daily_amount_pnl    numeric(14,2) not null default 0,
  daily_units_pnl     numeric(14,4) not null default 0,
  wins                integer       not null default 0,
  losses              integer       not null default 0,
  notes               text,
  created_at          timestamptz   not null default now(),
  updated_at          timestamptz   not null default now(),
  unique (system_id, date)
);

create index if not exists jbd_system_date_idx
  on public.journal_baseline_days (system_id, date);

drop trigger if exists jbd_touch on public.journal_baseline_days;
create trigger jbd_touch before update on public.journal_baseline_days
  for each row execute procedure public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Rebuild recompute_journal to merge baseline + tracked.
--
-- The CTE produces:
--   baseline : every row from journal_baseline_days (user-imported
--              historical aggregates, keyed by calendar date).
--   tracked  : the existing capper_day_entries aggregate by date,
--              filtered by testing-phase exclusion + the system-wide
--              "include archived/deleted" toggle.
-- The final union sums them so a date with both contributions becomes
-- one row (rare in practice — baseline is typically the pre-tracking
-- period — but mathematically correct if they overlap).
-- ---------------------------------------------------------------------
create or replace function public.recompute_journal(_system_id uuid)
returns void language plpgsql as $$
declare
  d record;
  cum_amt numeric := 0; cum_units numeric := 0; cum_wager numeric := 0;
  rec_w integer := 0; rec_l integer := 0;
  streak_val integer := 0; streak_type text := 'neutral_hold';
  max_win integer := 0; max_loss integer := 0;
  green_n integer := 0; red_n integer := 0;
  green_roi_cum numeric := 0; red_roi_cum numeric := 0;
  unit_size numeric; daily_roi numeric; win_rate numeric; running_roi numeric;
  v_include_archived boolean;
begin
  select coalesce(include_archived_in_system_metrics, true)
    into v_include_archived
    from public.systems
   where id = _system_id;
  v_include_archived := coalesce(v_include_archived, true);

  delete from public.journal_day_entries where system_id = _system_id;

  for d in
    with baseline as (
      select jbd.date,
             jbd.total_wager,
             jbd.total_bets,
             jbd.daily_amount_pnl,
             jbd.daily_units_pnl,
             jbd.wins,
             jbd.losses
        from public.journal_baseline_days jbd
       where jbd.system_id = _system_id
    ),
    tracked as (
      select cde.date,
             sum(cde.wager_total)        as total_wager,
             sum(cde.bet_count)          as total_bets,
             sum(cde.daily_amount_pnl)   as daily_amount_pnl,
             sum(cde.daily_units_pnl)    as daily_units_pnl,
             sum(cde.wins)               as wins,
             sum(cde.losses)             as losses
        from public.capper_day_entries cde
        join public.cappers c on c.id = cde.capper_id
       where cde.system_id = _system_id
         and coalesce(cde.excluded_from_system, false) = false
         and (
           v_include_archived
           or (coalesce(c.is_archived, false) = false
               and coalesce(c.is_deleted,  false) = false)
         )
       group by cde.date
    ),
    merged as (
      select * from baseline
      union all
      select * from tracked
    )
    select date,
           sum(total_wager)::numeric        as total_wager,
           sum(total_bets)::integer         as total_bets,
           sum(daily_amount_pnl)::numeric   as daily_amount_pnl,
           sum(daily_units_pnl)::numeric    as daily_units_pnl,
           sum(wins)::integer               as wins,
           sum(losses)::integer             as losses
      from merged
     group by date
     order by date asc
  loop
    unit_size := public.active_unit_size(_system_id, d.date);
    cum_amt   := cum_amt + d.daily_amount_pnl;
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
      case when red_n   = 0 then 0 else red_roi_cum   / red_n   end,
      case when (green_n + red_n) = 0 then 0
           else (green_n::numeric / (green_n + red_n)) * 100 end,
      streak_val, streak_type, max_win, max_loss, unit_size);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Trigger: when journal_baseline_days changes, rebuild the journal so
-- the dashboard + journal page reflect the imported rows immediately.
-- ---------------------------------------------------------------------
create or replace function public.trg_after_jbd()
returns trigger language plpgsql as $$
declare v_system uuid;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  v_system := coalesce(new.system_id, old.system_id);
  if v_system is null then return null; end if;
  perform public.recompute_journal(v_system);
  return null;
end $$;

drop trigger if exists jbd_after on public.journal_baseline_days;
create trigger jbd_after
  after insert or update or delete on public.journal_baseline_days
  for each row execute procedure public.trg_after_jbd();

-- ---------------------------------------------------------------------
-- One-time pass: recompute the journal for every system so the new
-- UNION shape is reflected even for systems that don't have any
-- baseline rows yet (no-op aside from refreshing the cached rows).
-- ---------------------------------------------------------------------
do $$
declare s record;
begin
  for s in select id from public.systems loop
    perform public.recompute_journal(s.id);
  end loop;
end $$;
