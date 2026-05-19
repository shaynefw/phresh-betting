-- =====================================================================
-- 0011_preserve_archived_deleted_in_system.sql
--
-- Preserve archived / deleted cappers' historical data inside collective
-- system metrics.
--
-- Behavior change:
--   - Archived cappers WERE excluded from dashboard system aggregation
--     (dashboard/page.tsx filtered `!c.is_archived`). They are now
--     included by default.
--   - Capper delete WAS a hard DELETE on `cappers` (cascading to days
--     and bets). It is now a soft delete via a new `is_deleted` flag,
--     so the day + bet history stays in the system.
--   - A new system-level setting `include_archived_in_system_metrics`
--     (default TRUE) lets the user opt OUT of including archived /
--     deleted cappers in system-wide aggregates if they ever want to.
--
-- This migration is idempotent.
-- =====================================================================

-- 1. Soft-delete flag on cappers.
alter table public.cappers
  add column if not exists is_deleted boolean not null default false;

create index if not exists cappers_active_lookup
  on public.cappers (system_id, is_archived, is_deleted);

-- 2. System-level setting (per-system because each system has its own
--    capper roster). Default TRUE = include archived/deleted in
--    collective metrics.
alter table public.systems
  add column if not exists include_archived_in_system_metrics
    boolean not null default true;

-- 3. Rebuild recompute_journal so it honors the setting. When the
--    setting is TRUE (default) the journal includes archived/deleted
--    cappers' days exactly the same as active cappers'. When FALSE,
--    those days are filtered out of every journal day, which in turn
--    flows through to the dashboard's progress bars, cumulative units
--    chart, scaling state, and exports because they all read from
--    journal_day_entries.
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
     order by cde.date asc
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

-- 4. When a capper's archive / delete state flips, or when the system
--    setting itself is toggled, rebuild the journal so dashboard
--    metrics reflect the new inclusion immediately.
create or replace function public.trg_after_capper_lifecycle()
returns trigger language plpgsql as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if old.is_archived is distinct from new.is_archived
     or old.is_deleted is distinct from new.is_deleted then
    perform public.recompute_journal(new.system_id);
  end if;
  return null;
end $$;

drop trigger if exists cappers_archive_delete_change on public.cappers;
create trigger cappers_archive_delete_change
  after update of is_archived, is_deleted on public.cappers
  for each row execute procedure public.trg_after_capper_lifecycle();

create or replace function public.trg_after_system_include_archived()
returns trigger language plpgsql as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if old.include_archived_in_system_metrics
       is distinct from new.include_archived_in_system_metrics then
    perform public.recompute_journal(new.id);
  end if;
  return null;
end $$;

drop trigger if exists systems_include_archived_change on public.systems;
create trigger systems_include_archived_change
  after update of include_archived_in_system_metrics on public.systems
  for each row execute procedure public.trg_after_system_include_archived();

-- 5. Restoration pass.
--    Recompute the journal for every system once so any previously-
--    archived cappers' baseline data is folded back into the dashboard
--    immediately under the new default. (Previously hard-deleted
--    cappers' rows are GONE and cannot be restored — only future
--    deletes are protected by the new soft-delete flag.)
do $$
declare s record;
begin
  for s in select id from public.systems loop
    perform public.recompute_journal(s.id);
  end loop;
end $$;
