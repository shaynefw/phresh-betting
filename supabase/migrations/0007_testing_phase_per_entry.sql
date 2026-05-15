-- =====================================================================
-- 0007: Per-entry Testing-Phase exclusion flag.
--
-- Replaces the prior "whole capper currently in testing → all of its
-- days are excluded" model with a per-day flag captured at INSERT time.
-- This means toggling a capper's testing state NEVER retroactively
-- reclassifies past entries:
--   - Bets created BEFORE testing was toggled on always count toward
--     system metrics.
--   - Bets created WHILE the capper is actively in Testing Phase do not
--     count toward system metrics.
--   - Bets created AFTER toggling testing off again count toward system
--     metrics.
-- Individual capper metrics include ALL days regardless of the flag.
-- =====================================================================

-- 1. Add the per-entry flag (nullable so the BEFORE INSERT trigger can
--    detect "caller didn't provide a value" and snapshot from cappers).
alter table public.capper_day_entries
  add column if not exists excluded_from_system boolean;

-- 2. Backfill: any pre-existing day belonging to a currently-testing
--    capper is marked excluded (best-effort match for the prior
--    whole-capper behavior at this moment in time). Non-testing
--    cappers' days default to included.
update public.capper_day_entries cde
   set excluded_from_system = c.is_testing
  from public.cappers c
 where cde.capper_id = c.id
   and cde.excluded_from_system is null;
update public.capper_day_entries
   set excluded_from_system = false
 where excluded_from_system is null;

-- 3. BEFORE INSERT trigger: snapshot the capper's current is_testing
--    into excluded_from_system. Updates leave the flag alone, so once
--    classified, an entry's exclusion state is permanent.
--    The trigger skips if the caller already provided a value (used by
--    backup import, which restores per-day exclusion state verbatim).
create or replace function public.trg_before_cde_insert_excluded()
returns trigger language plpgsql as $$
begin
  if new.excluded_from_system is null then
    select coalesce(is_testing, false) into new.excluded_from_system
      from public.cappers where id = new.capper_id;
    if new.excluded_from_system is null then
      new.excluded_from_system := false;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists cde_before_insert_excluded on public.capper_day_entries;
create trigger cde_before_insert_excluded
  before insert on public.capper_day_entries
  for each row execute procedure public.trg_before_cde_insert_excluded();

-- 4. recompute_journal now filters by the per-entry flag (instead of
--    joining cappers and checking is_testing). Past entries keep their
--    original classification forever.
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
    select cde.date,
           sum(cde.wager_total)        as total_wager,
           sum(cde.bet_count)          as total_bets,
           sum(cde.daily_amount_pnl)   as daily_amount_pnl,
           sum(cde.daily_units_pnl)    as daily_units_pnl,
           sum(cde.wins)               as wins,
           sum(cde.losses)             as losses
      from public.capper_day_entries cde
     where cde.system_id = _system_id
       and coalesce(cde.excluded_from_system, false) = false
     group by cde.date order by cde.date asc
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

-- 5. Remove the "recompute journal on testing toggle" trigger — no
--    longer needed: per-entry flag is permanent at write time, so
--    flipping is_testing must NOT alter past entries' exclusion.
drop trigger if exists cappers_testing_change on public.cappers;
drop function if exists public.trg_after_capper_testing();
