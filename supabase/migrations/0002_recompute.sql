-- =====================================================================
-- Recompute functions: capper rollups, journal sync, scaling resolver
-- =====================================================================

-- Resolve the active unit size on a given date for a system.
create or replace function public.active_unit_size(_system_id uuid, _on date)
returns numeric language sql stable as $$
  select unit_size_dollars
    from public.scaling_log_entries
   where system_id = _system_id
     and effective_date <= _on
   order by effective_date desc, created_at desc
   limit 1;
$$;

-- Apply scaling rule from a base size: round to nearest whole dollar after +/- 25%.
create or replace function public.scale_size(_size numeric, _direction int)
returns numeric language sql immutable as $$
  select round(_size * (1 + (0.25 * _direction)))::numeric;
$$;

-- ---------------------------------------------------------------------
-- Recompute a single capper's day rollups from earliest day forward.
-- Called whenever a capper_day_entry or capper_bet_entry changes.
-- ---------------------------------------------------------------------
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
  bet_count          integer;
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
    -- if bet-level mode, recompute totals from child bets
    if d.entry_mode = 'bet_level' then
      select
        coalesce(sum(wager_amount) filter (where bet_result <> 'void'),0),
        coalesce(sum(amount_pnl) filter (where bet_result <> 'void'),0),
        coalesce(count(*) filter (where bet_result <> 'void'),0),
        coalesce(count(*) filter (where bet_result = 'win'),0),
        coalesce(count(*) filter (where bet_result = 'loss'),0),
        coalesce(count(*) filter (where bet_result = 'void'),0)
      into sum_wager, sum_pnl, bet_count, bet_w, bet_l, bet_v
      from public.capper_bet_entries
      where capper_day_entry_id = d.id;
    else
      sum_wager := d.wager_total;
      sum_pnl   := d.daily_amount_pnl;
      bet_count := d.bet_count;
      bet_w     := d.wins;
      bet_l     := d.losses;
    end if;

    -- unit size for the day (snapshot if missing)
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

    -- streak logic by daily ROI sign
    if daily_roi > 0 then
      if streak_type = 'green' then streak_val := streak_val + 1; else streak_val := 1; end if;
      streak_type := 'green';
      if streak_val > max_win then max_win := streak_val; end if;
    elsif daily_roi < 0 then
      if streak_type = 'red' then streak_val := streak_val + 1; else streak_val := 1; end if;
      streak_type := 'red';
      if streak_val > max_loss then max_loss := streak_val; end if;
    end if;
    -- daily_roi = 0: hold streak unchanged

    update public.capper_day_entries set
      wager_total          = sum_wager,
      bet_count            = bet_count,
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

-- ---------------------------------------------------------------------
-- Recompute the system journal from earliest capper day forward.
-- Aggregates all capper_day_entries by date.
-- ---------------------------------------------------------------------
create or replace function public.recompute_journal(_system_id uuid)
returns void language plpgsql as $$
declare
  d                       record;
  cum_amt                 numeric := 0;
  cum_units               numeric := 0;
  cum_wager               numeric := 0;
  rec_w                   integer := 0;
  rec_l                   integer := 0;
  streak_val              integer := 0;
  streak_type             text    := 'neutral_hold';
  max_win                 integer := 0;
  max_loss                integer := 0;
  green_n                 integer := 0;
  red_n                   integer := 0;
  green_roi_cum           numeric := 0;
  red_roi_cum             numeric := 0;
  unit_size               numeric;
  daily_roi               numeric;
  win_rate                numeric;
  running_roi             numeric;
begin
  -- wipe and rebuild journal for clean determinism
  delete from public.journal_day_entries where system_id = _system_id;

  for d in
    select date,
           sum(wager_total)        as total_wager,
           sum(bet_count)          as total_bets,
           sum(daily_amount_pnl)   as daily_amount_pnl,
           sum(daily_units_pnl)    as daily_units_pnl,
           sum(wins)               as wins,
           sum(losses)             as losses
      from public.capper_day_entries
     where system_id = _system_id
     group by date
     order by date asc
  loop
    unit_size   := public.active_unit_size(_system_id, d.date);
    cum_amt     := cum_amt + d.daily_amount_pnl;
    cum_units   := cum_units + d.daily_units_pnl;
    cum_wager   := cum_wager + d.total_wager;
    rec_w       := rec_w + d.wins;
    rec_l       := rec_l + d.losses;
    daily_roi   := case when d.total_wager = 0 then 0 else (d.daily_amount_pnl / d.total_wager) * 100 end;
    running_roi := case when cum_wager = 0 then 0 else (cum_amt / cum_wager) * 100 end;
    win_rate    := case when (d.wins + d.losses) = 0 then 0 else (d.wins::numeric / (d.wins + d.losses)) * 100 end;

    if daily_roi > 0 then
      green_n := green_n + 1;
      green_roi_cum := green_roi_cum + daily_roi;
      if streak_type = 'green' then streak_val := streak_val + 1; else streak_val := 1; end if;
      streak_type := 'green';
      if streak_val > max_win then max_win := streak_val; end if;
    elsif daily_roi < 0 then
      red_n := red_n + 1;
      red_roi_cum := red_roi_cum + daily_roi;
      if streak_type = 'red' then streak_val := streak_val + 1; else streak_val := 1; end if;
      streak_type := 'red';
      if streak_val > max_loss then max_loss := streak_val; end if;
    end if;

    insert into public.journal_day_entries (
      system_id, date, total_wager, total_bets,
      total_system_risk_cumulative, daily_amount_pnl, cumulative_amount_pnl,
      daily_units_pnl, cumulative_units_pnl, daily_roi_percent, running_roi_percent,
      wins, losses, win_rate_percent, record_wins, record_losses,
      green_day_count, red_day_count, green_day_roi_cumulative, red_day_roi_cumulative,
      green_day_avg_roi, red_day_avg_roi, green_day_probability,
      current_streak_value, current_streak_type, max_win_streak, max_loss_streak,
      unit_size_used
    ) values (
      _system_id, d.date, d.total_wager, d.total_bets,
      cum_wager, d.daily_amount_pnl, cum_amt,
      d.daily_units_pnl, cum_units, daily_roi, running_roi,
      d.wins, d.losses, win_rate, rec_w, rec_l,
      green_n, red_n, green_roi_cum, red_roi_cum,
      case when green_n = 0 then 0 else green_roi_cum / green_n end,
      case when red_n   = 0 then 0 else red_roi_cum   / red_n   end,
      case when (green_n + red_n) = 0 then 0
           else (green_n::numeric / (green_n + red_n)) * 100 end,
      streak_val, streak_type, max_win, max_loss,
      unit_size
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Triggers that keep capper rollups + journal in sync.
-- They invoke recompute on capper / journal scope.
-- ---------------------------------------------------------------------
create or replace function public.trg_after_cde()
returns trigger language plpgsql as $$
declare
  v_capper uuid;
  v_system uuid;
begin
  v_capper := coalesce(new.capper_id, old.capper_id);
  v_system := coalesce(new.system_id, old.system_id);
  perform public.recompute_capper(v_capper);
  perform public.recompute_journal(v_system);
  return null;
end $$;

drop trigger if exists cde_after on public.capper_day_entries;
create trigger cde_after
  after insert or update or delete on public.capper_day_entries
  for each row execute procedure public.trg_after_cde();

create or replace function public.trg_after_cbe()
returns trigger language plpgsql as $$
declare
  v_capper uuid;
  v_system uuid;
begin
  v_capper := coalesce(new.capper_id, old.capper_id);
  v_system := coalesce(new.system_id, old.system_id);
  perform public.recompute_capper(v_capper);
  perform public.recompute_journal(v_system);
  return null;
end $$;

drop trigger if exists cbe_after on public.capper_bet_entries;
create trigger cbe_after
  after insert or update or delete on public.capper_bet_entries
  for each row execute procedure public.trg_after_cbe();

-- when scaling log changes, recompute every capper in the system + journal
create or replace function public.trg_after_scaling()
returns trigger language plpgsql as $$
declare
  c record;
  v_system uuid;
begin
  v_system := coalesce(new.system_id, old.system_id);
  for c in select id from public.cappers where system_id = v_system loop
    perform public.recompute_capper(c.id);
  end loop;
  perform public.recompute_journal(v_system);
  return null;
end $$;

drop trigger if exists scaling_after on public.scaling_log_entries;
create trigger scaling_after
  after insert or update or delete on public.scaling_log_entries
  for each row execute procedure public.trg_after_scaling();
