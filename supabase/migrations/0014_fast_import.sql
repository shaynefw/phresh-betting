-- =====================================================================
-- Fast backup import.
--
-- The per-row triggers cde_after / cbe_after / jbd_after each run
-- recompute_capper + recompute_journal on every insert. That makes a
-- normal import of a ~1000-bet backup hit Postgres's statement timeout
-- (the import does O(N²) work).
--
-- This function takes the full backup payload as a single JSONB blob,
-- disables triggers for the session via session_replication_role,
-- bulk-inserts every table in dependency order, then runs the
-- recompute functions ONCE per affected capper plus once for the
-- system journal. Total work is now O(N).
--
-- SECURITY DEFINER so it runs with the function-owner's privileges
-- (postgres) and can flip session_replication_role. The caller is
-- still gated by the JS route handler, which verifies the caller owns
-- the systemId before invoking this function.
-- =====================================================================

create or replace function public.import_backup_fast(
  p_system_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capper record;
  v_cappers_n int := 0;
  v_days_n int := 0;
  v_bets_n int := 0;
  v_baselines_n int := 0;
  v_system_baseline_imported boolean := false;
  v_chart_n int := 0;
  v_jbd_n int := 0;
begin
  -- Triggers off for the rest of this function. This skips the
  -- recompute calls on every insert; we do them once at the end.
  set local session_replication_role = 'replica';

  -- ----- Wipe in FK-safe order -------------------------------------
  delete from public.scaling_log_entries where system_id = p_system_id;
  delete from public.capper_bet_entries  where system_id = p_system_id;
  delete from public.capper_day_entries  where system_id = p_system_id;
  delete from public.capper_baselines    where system_id = p_system_id;
  delete from public.system_baselines    where system_id = p_system_id;
  delete from public.chart_baseline_points where system_id = p_system_id;
  delete from public.journal_baseline_days where system_id = p_system_id;
  delete from public.journal_day_entries where system_id = p_system_id;
  delete from public.cappers              where system_id = p_system_id;

  -- ----- Scaling log -----------------------------------------------
  if jsonb_typeof(p_payload->'scaling') = 'array' then
    insert into public.scaling_log_entries (
      system_id, effective_date, starting_units_threshold,
      ending_units_threshold, unit_size_dollars, bankroll, notes
    )
    select
      p_system_id,
      (r->>'effective_date')::date,
      coalesce((r->>'starting_units_threshold')::numeric, 0),
      coalesce((r->>'ending_units_threshold')::numeric, 0),
      coalesce((r->>'unit_size_dollars')::numeric, 0),
      nullif(r->>'bankroll', '')::numeric,
      r->>'notes'
    from jsonb_array_elements(p_payload->'scaling') r;
  end if;

  -- ----- Cappers (preserve IDs) ------------------------------------
  if jsonb_typeof(p_payload->'cappers') = 'array' then
    insert into public.cappers (
      id, system_id, name, base_system_risk_units,
      is_active, is_archived, is_deleted, is_testing,
      current_phase, checklist_status, sort_order, notes
    )
    select
      (r->>'id')::uuid,
      p_system_id,
      r->>'name',
      coalesce((r->>'base_system_risk_units')::numeric, 0),
      coalesce((r->>'is_active')::boolean, true),
      coalesce((r->>'is_archived')::boolean, false),
      coalesce((r->>'is_deleted')::boolean, false),
      coalesce((r->>'is_testing')::boolean, false),
      coalesce(r->>'current_phase', 'lukewarm'),
      coalesce(r->>'checklist_status', 'started'),
      coalesce((r->>'sort_order')::int, 0),
      r->>'notes'
    from jsonb_array_elements(p_payload->'cappers') r;
    get diagnostics v_cappers_n = row_count;
  end if;

  -- ----- Capper day entries (preserve IDs) -------------------------
  if jsonb_typeof(p_payload->'capper_days') = 'array' then
    insert into public.capper_day_entries (
      id, capper_id, system_id, date, entry_mode,
      wager_total, bet_count, daily_amount_pnl, wins, losses,
      unit_size_used, excluded_from_system, notes
    )
    select
      (r->>'id')::uuid,
      (r->>'capper_id')::uuid,
      p_system_id,
      (r->>'date')::date,
      coalesce(r->>'entry_mode', 'daily_totals'),
      coalesce((r->>'wager_total')::numeric, 0),
      coalesce((r->>'bet_count')::int, 0),
      coalesce((r->>'daily_amount_pnl')::numeric, 0),
      coalesce((r->>'wins')::int, 0),
      coalesce((r->>'losses')::int, 0),
      nullif(r->>'unit_size_used', '')::numeric,
      coalesce((r->>'excluded_from_system')::boolean, false),
      r->>'notes'
    from jsonb_array_elements(p_payload->'capper_days') r
    where exists (
      select 1 from public.cappers c
      where c.id = (r->>'capper_id')::uuid
        and c.system_id = p_system_id
    );
    get diagnostics v_days_n = row_count;
  end if;

  -- ----- Capper bet entries ----------------------------------------
  if jsonb_typeof(p_payload->'capper_bets') = 'array' then
    insert into public.capper_bet_entries (
      capper_day_entry_id, capper_id, system_id, date,
      wager_amount, odds, bet_result, amount_pnl,
      units_risk_multiplier, notes, sport
    )
    select
      (r->>'capper_day_entry_id')::uuid,
      (r->>'capper_id')::uuid,
      p_system_id,
      (r->>'date')::date,
      coalesce((r->>'wager_amount')::numeric, 0),
      nullif(r->>'odds', '')::numeric,
      coalesce(r->>'bet_result', 'pending'),
      coalesce((r->>'amount_pnl')::numeric, 0),
      nullif(r->>'units_risk_multiplier', '')::numeric,
      r->>'notes',
      r->>'sport'
    from jsonb_array_elements(p_payload->'capper_bets') r
    where exists (
      select 1 from public.capper_day_entries d
      where d.id = (r->>'capper_day_entry_id')::uuid
        and d.system_id = p_system_id
    );
    get diagnostics v_bets_n = row_count;
  end if;

  -- ----- Capper baselines ------------------------------------------
  if jsonb_typeof(p_payload->'capper_baselines') = 'array' then
    insert into public.capper_baselines (
      capper_id, system_id,
      total_betting_days, total_bets, total_risk,
      cumulative_amount_pnl, cumulative_units_pnl,
      wins, losses, green_day_count, red_day_count,
      green_day_roi_cumulative, red_day_roi_cumulative,
      running_roi_percent, win_rate_percent,
      green_day_avg_roi, red_day_avg_roi, green_day_probability,
      current_streak_value, current_streak_type,
      max_win_streak, max_loss_streak, streak_breakdown, notes
    )
    select
      (r->>'capper_id')::uuid,
      p_system_id,
      coalesce((r->>'total_betting_days')::int, 0),
      coalesce((r->>'total_bets')::int, 0),
      coalesce((r->>'total_risk')::numeric, 0),
      coalesce((r->>'cumulative_amount_pnl')::numeric, 0),
      coalesce((r->>'cumulative_units_pnl')::numeric, 0),
      coalesce((r->>'wins')::int, 0),
      coalesce((r->>'losses')::int, 0),
      coalesce((r->>'green_day_count')::int, 0),
      coalesce((r->>'red_day_count')::int, 0),
      coalesce((r->>'green_day_roi_cumulative')::numeric, 0),
      coalesce((r->>'red_day_roi_cumulative')::numeric, 0),
      coalesce((r->>'running_roi_percent')::numeric, 0),
      coalesce((r->>'win_rate_percent')::numeric, 0),
      coalesce((r->>'green_day_avg_roi')::numeric, 0),
      coalesce((r->>'red_day_avg_roi')::numeric, 0),
      coalesce((r->>'green_day_probability')::numeric, 0),
      coalesce((r->>'current_streak_value')::int, 0),
      coalesce(r->>'current_streak_type', 'neutral_hold'),
      coalesce((r->>'max_win_streak')::int, 0),
      coalesce((r->>'max_loss_streak')::int, 0),
      coalesce(r->'streak_breakdown', '[]'::jsonb),
      r->>'notes'
    from jsonb_array_elements(p_payload->'capper_baselines') r
    where exists (
      select 1 from public.cappers c
      where c.id = (r->>'capper_id')::uuid
        and c.system_id = p_system_id
    );
    get diagnostics v_baselines_n = row_count;
  end if;

  -- ----- System baseline (single row) ------------------------------
  if jsonb_typeof(p_payload->'system_baseline') = 'object' then
    insert into public.system_baselines (
      system_id, total_betting_days, total_bets, total_risk,
      cumulative_amount_pnl, cumulative_units_pnl, wins, losses,
      green_day_count, red_day_count,
      green_day_roi_cumulative, red_day_roi_cumulative,
      running_roi_percent, win_rate_percent,
      green_day_avg_roi, red_day_avg_roi, green_day_probability,
      max_win_streak, max_loss_streak, streak_breakdown, notes
    )
    select
      p_system_id,
      coalesce((r->>'total_betting_days')::int, 0),
      coalesce((r->>'total_bets')::int, 0),
      coalesce((r->>'total_risk')::numeric, 0),
      coalesce((r->>'cumulative_amount_pnl')::numeric, 0),
      coalesce((r->>'cumulative_units_pnl')::numeric, 0),
      coalesce((r->>'wins')::int, 0),
      coalesce((r->>'losses')::int, 0),
      coalesce((r->>'green_day_count')::int, 0),
      coalesce((r->>'red_day_count')::int, 0),
      coalesce((r->>'green_day_roi_cumulative')::numeric, 0),
      coalesce((r->>'red_day_roi_cumulative')::numeric, 0),
      coalesce((r->>'running_roi_percent')::numeric, 0),
      coalesce((r->>'win_rate_percent')::numeric, 0),
      coalesce((r->>'green_day_avg_roi')::numeric, 0),
      coalesce((r->>'red_day_avg_roi')::numeric, 0),
      coalesce((r->>'green_day_probability')::numeric, 0),
      coalesce((r->>'max_win_streak')::int, 0),
      coalesce((r->>'max_loss_streak')::int, 0),
      coalesce(r->'streak_breakdown', '[]'::jsonb),
      r->>'notes'
    from (select p_payload->'system_baseline' as r) x;
    v_system_baseline_imported := true;
  end if;

  -- ----- Chart baseline points -------------------------------------
  if jsonb_typeof(p_payload->'chart_baseline_points') = 'array' then
    insert into public.chart_baseline_points (
      system_id, capper_id, day_number, cumulative_units, notes
    )
    select
      p_system_id,
      case
        when (r->>'capper_id') is null then null
        else (r->>'capper_id')::uuid
      end,
      coalesce((r->>'day_number')::int, 0),
      coalesce((r->>'cumulative_units')::numeric, 0),
      r->>'notes'
    from jsonb_array_elements(p_payload->'chart_baseline_points') r
    where coalesce((r->>'day_number')::int, 0) >= 1
      and (
        (r->>'capper_id') is null
        or exists (
          select 1 from public.cappers c
          where c.id = (r->>'capper_id')::uuid
            and c.system_id = p_system_id
        )
      );
    get diagnostics v_chart_n = row_count;
  end if;

  -- ----- Journal baseline days -------------------------------------
  if jsonb_typeof(p_payload->'journal_baseline_days') = 'array' then
    insert into public.journal_baseline_days (
      system_id, date, total_wager, total_bets,
      daily_amount_pnl, daily_units_pnl, wins, losses, notes
    )
    select
      p_system_id,
      (r->>'date')::date,
      coalesce((r->>'total_wager')::numeric, 0),
      coalesce((r->>'total_bets')::int, 0),
      coalesce((r->>'daily_amount_pnl')::numeric, 0),
      coalesce((r->>'daily_units_pnl')::numeric, 0),
      coalesce((r->>'wins')::int, 0),
      coalesce((r->>'losses')::int, 0),
      r->>'notes'
    from jsonb_array_elements(p_payload->'journal_baseline_days') r
    where (r->>'date') ~ '^\d{4}-\d{2}-\d{2}$'
    on conflict (system_id, date) do nothing;
    get diagnostics v_jbd_n = row_count;
  end if;

  -- Triggers back on for the rest of the session, then run the
  -- recompute functions ONCE per affected capper plus once for the
  -- journal. That replaces the thousands of per-row trigger fires
  -- that timed out the old import.
  set local session_replication_role = 'origin';

  for v_capper in
    select id from public.cappers where system_id = p_system_id
  loop
    perform public.recompute_capper(v_capper.id);
  end loop;

  perform public.recompute_journal(p_system_id);

  return jsonb_build_object(
    'ok', true,
    'cappers', v_cappers_n,
    'days', v_days_n,
    'bets', v_bets_n,
    'baselines', v_baselines_n,
    'system_baseline', v_system_baseline_imported,
    'chart_points', v_chart_n,
    'journal_baseline_days', v_jbd_n
  );
end;
$$;

-- Lock down: only service_role (used by the JS route handler) can call.
revoke all on function public.import_backup_fast(uuid, jsonb) from public;
grant execute on function public.import_backup_fast(uuid, jsonb) to service_role;
