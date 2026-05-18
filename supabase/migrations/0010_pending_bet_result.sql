-- 0010_pending_bet_result.sql
--
-- Adds a new "pending" result value to capper_bet_entries.bet_result for
-- bets that have been logged but whose outcome (and PnL) is not yet known.
--
-- Pending bets must NOT contribute to any rollups:
--   - capper_day_entries.{wager_total, bet_count, daily_amount_pnl, wins, losses}
--   - cumulative units / running ROI / streak math (downstream of those)
--   - journal aggregates (also downstream of the day-entry rollups)
--
-- The aggregation lives in recompute_capper(). It already excludes 'void'
-- via FILTER clauses; we widen the same filter to also exclude 'pending'.
-- The trg_after_cbe trigger already re-fires on INSERT/UPDATE/DELETE, so
-- when a user edits a bet from pending → win/loss/void, this function
-- runs and the bet starts contributing automatically.
--
-- Idempotent: safe to re-run on environments that already migrated.

-- 1. Widen the CHECK constraint to accept 'pending'.
alter table public.capper_bet_entries
  drop constraint if exists capper_bet_entries_bet_result_check;
alter table public.capper_bet_entries
  add  constraint capper_bet_entries_bet_result_check
       check (bet_result in ('win','loss','void','pending'));

-- 2. Replace recompute_capper with the version that also filters out
--    pending bets from the bet-level day aggregation.
create or replace function public.recompute_capper(_capper_id uuid)
returns void language plpgsql as $$
declare
  d                  record;
  cum_amt            numeric := 0;
  cum_units          numeric := 0;
  cum_wager          numeric := 0;
  rec_w              integer := 0;
  rec_l              integer := 0;
  streak_val         integer := 0;
  streak_type        text    := 'neutral_hold';
  max_win            integer := 0;
  max_loss           integer := 0;
  bet_w              integer;
  bet_l              integer;
  bet_v              integer;
  sum_wager          numeric;
  sum_pnl            numeric;
  v_bet_count        integer;
  unit_size          numeric;
  daily_units        numeric;
  daily_roi          numeric;
  win_rate           numeric;
  running_roi        numeric;
  sysid              uuid;
begin
  select system_id into sysid from public.cappers where id = _capper_id;
  if sysid is null then return; end if;

  for d in
    select * from public.capper_day_entries
     where capper_id = _capper_id
     order by date asc, created_at asc
  loop
    -- if bet-level mode, recompute totals from child bets.
    -- 'void' and 'pending' bets are excluded from every aggregate so the
    -- parent day's wager_total / pnl / count never reflect unresolved bets.
    if d.entry_mode = 'bet_level' then
      select
        coalesce(sum(wager_amount) filter (where bet_result not in ('void','pending')),0),
        coalesce(sum(amount_pnl)   filter (where bet_result not in ('void','pending')),0),
        coalesce(count(*)          filter (where bet_result not in ('void','pending')),0),
        coalesce(count(*)          filter (where bet_result = 'win'),0),
        coalesce(count(*)          filter (where bet_result = 'loss'),0),
        coalesce(count(*)          filter (where bet_result = 'void'),0)
      into sum_wager, sum_pnl, v_bet_count, bet_w, bet_l, bet_v
      from public.capper_bet_entries
      where capper_day_entry_id = d.id;
    else
      sum_wager   := d.wager_total;
      sum_pnl     := d.daily_amount_pnl;
      v_bet_count := d.bet_count;
      bet_w       := d.wins;
      bet_l       := d.losses;
    end if;

    unit_size := coalesce(d.unit_size_used, public.active_unit_size(d.system_id, d.date), 1);
    if unit_size = 0 then unit_size := 1; end if;

    daily_units := case when unit_size = 0 then 0 else sum_pnl / unit_size end;
    daily_roi   := case when sum_wager = 0 then 0 else (sum_pnl / sum_wager) * 100 end;

    cum_amt   := cum_amt + sum_pnl;
    cum_units := cum_units + daily_units;
    cum_wager := cum_wager + sum_wager;
    rec_w     := rec_w + bet_w;
    rec_l     := rec_l + bet_l;
    win_rate  := case when (bet_w + bet_l) = 0 then 0 else (bet_w::numeric / (bet_w + bet_l)) * 100 end;
    running_roi := case when cum_wager = 0 then 0 else (cum_amt / cum_wager) * 100 end;

    -- streak logic by daily ROI sign (unchanged)
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
      wager_total          = sum_wager,
      bet_count            = v_bet_count,
      daily_amount_pnl     = sum_pnl,
      wins                 = bet_w,
      losses               = bet_l,
      unit_size_used       = unit_size,
      daily_units_pnl      = daily_units,
      daily_roi_percent    = daily_roi,
      cumulative_amount_pnl= cum_amt,
      cumulative_units_pnl = cum_units,
      running_roi_percent  = running_roi,
      win_rate_percent     = win_rate,
      record_wins          = rec_w,
      record_losses        = rec_l,
      current_streak_value = streak_val,
      current_streak_type  = streak_type,
      max_win_streak       = max_win,
      max_loss_streak      = max_loss
    where id = d.id;
  end loop;
end $$;
