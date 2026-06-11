/**
 * Backup-import logic, factored out of the legacy `importBackup` server
 * action so it can be invoked from a Route Handler instead. Server
 * Actions encode arguments via React Flight, which trips a
 * "Maximum array nesting exceeded" safety on backups with thousands of
 * bets/days. Route Handlers receive a plain JSON body and skip Flight.
 *
 * Caller is responsible for authenticating + verifying system
 * ownership before invoking this function. It assumes the systemId is
 * already trusted.
 */
import { createAdminClient } from "@/lib/supabase/admin";

export interface BackupPayload {
  system: { name: string };
  scaling: Array<Record<string, unknown>>;
  cappers: Array<{
    id: string;
    name: string;
    base_system_risk_units: number;
    is_active: boolean;
    is_archived: boolean;
    is_deleted?: boolean;
    is_testing?: boolean;
    current_phase: string;
    checklist_status: string;
    sort_order?: number;
    notes?: string | null;
  }>;
  capper_days: Array<{
    id: string;
    capper_id: string;
    date: string;
    entry_mode: string;
    wager_total: number;
    bet_count: number;
    daily_amount_pnl: number;
    wins: number;
    losses: number;
    unit_size_used?: number | null;
    excluded_from_system?: boolean;
    notes?: string | null;
  }>;
  capper_bets: Array<{
    capper_day_entry_id: string;
    capper_id: string;
    date: string;
    wager_amount: number;
    odds: number | null;
    bet_result: string;
    amount_pnl: number;
    units_risk_multiplier?: number | null;
    notes?: string | null;
    sport?: string | null;
  }>;
  chart_baseline_points?: Array<{
    system_id?: string;
    capper_id?: string | null;
    date?: string;
    day_number?: number;
    cumulative_units: number;
    notes?: string | null;
  }>;
  journal_baseline_days?: Array<{
    date: string;
    total_wager?: number;
    total_bets?: number;
    daily_amount_pnl?: number;
    daily_units_pnl?: number;
    wins?: number;
    losses?: number;
    notes?: string | null;
  }>;
  system_baseline?: {
    total_betting_days: number;
    total_bets: number;
    total_risk: number;
    cumulative_amount_pnl: number;
    cumulative_units_pnl: number;
    wins: number;
    losses: number;
    green_day_count: number;
    red_day_count: number;
    green_day_roi_cumulative: number;
    red_day_roi_cumulative: number;
    running_roi_percent: number;
    win_rate_percent: number;
    green_day_avg_roi: number;
    red_day_avg_roi: number;
    green_day_probability: number;
    max_win_streak: number;
    max_loss_streak: number;
    streak_breakdown?: Array<{ type: "green" | "red"; length: number; count: number }>;
    notes?: string | null;
  } | null;
  capper_baselines?: Array<{
    capper_id: string;
    total_betting_days: number;
    total_bets: number;
    total_risk: number;
    cumulative_amount_pnl: number;
    cumulative_units_pnl: number;
    wins: number;
    losses: number;
    green_day_count: number;
    red_day_count: number;
    green_day_roi_cumulative: number;
    red_day_roi_cumulative: number;
    running_roi_percent: number;
    win_rate_percent: number;
    green_day_avg_roi: number;
    red_day_avg_roi: number;
    green_day_probability: number;
    current_streak_value: number;
    current_streak_type: "green" | "red" | "neutral_hold";
    max_win_streak: number;
    max_loss_streak: number;
    streak_breakdown?: Array<{ type: "green" | "red"; length: number; count: number }>;
    notes?: string | null;
  }>;
}

export interface ImportSummary {
  cappers: number;
  days: number;
  bets: number;
  baselines: number;
  system_baseline: boolean;
  chart_points: number;
  journal_baseline_days: number;
}

export type ImportResult =
  | { ok: true; summary: ImportSummary }
  | { ok: false; error: string };

export async function runImportBackup(
  systemId: string,
  data: BackupPayload,
): Promise<ImportResult> {
  if (!data?.system || !Array.isArray(data.scaling)) {
    return { ok: false, error: "Unrecognized backup format" };
  }
  const sb = createAdminClient();

  // FAST PATH — call the SECURITY DEFINER RPC defined in migration
  // 0014_fast_import.sql. It disables triggers via session_replication_
  // role, bulk-inserts every table, then runs recompute_capper once
  // per affected capper plus recompute_journal once. This is the only
  // path that fits inside Supabase's default 8-second statement
  // timeout for backups of any meaningful size.
  //
  // If the RPC doesn't exist yet (user hasn't applied the migration),
  // we surface a clear error instead of silently falling back to the
  // slow row-by-row path that's known to time out.
  const { data: rpcData, error: rpcError } = await sb.rpc("import_backup_fast", {
    p_system_id: systemId,
    p_payload: data as unknown as Record<string, unknown>,
  });

  if (rpcError) {
    const msg = rpcError.message ?? "";
    // PostgREST returns PGRST202 / "Could not find the function" when
    // the migration hasn't been applied yet.
    if (
      rpcError.code === "PGRST202" ||
      /could not find the function|function .*import_backup_fast/i.test(msg)
    ) {
      return {
        ok: false,
        error:
          "Backup import requires migration 0014_fast_import.sql. Apply it in the Supabase SQL editor, then try again.",
      };
    }
    return { ok: false, error: msg || "Import failed" };
  }

  const r = rpcData as {
    ok: boolean;
    cappers?: number;
    days?: number;
    bets?: number;
    baselines?: number;
    system_baseline?: boolean;
    chart_points?: number;
    journal_baseline_days?: number;
  } | null;

  if (r?.ok) {
    return {
      ok: true,
      summary: {
        cappers: r.cappers ?? 0,
        days: r.days ?? 0,
        bets: r.bets ?? 0,
        baselines: r.baselines ?? 0,
        system_baseline: !!r.system_baseline,
        chart_points: r.chart_points ?? 0,
        journal_baseline_days: r.journal_baseline_days ?? 0,
      },
    };
  }

  // Defensive: RPC returned non-ok shape. Fall through to the legacy
  // path so we surface a deterministic error rather than hanging.

  // Wipe in FK-safe order. Children first, then parents.
  await sb.from("scaling_log_entries").delete().eq("system_id", systemId);
  await sb.from("capper_bet_entries").delete().eq("system_id", systemId);
  await sb.from("capper_day_entries").delete().eq("system_id", systemId);
  await sb.from("capper_baselines").delete().eq("system_id", systemId);
  await sb.from("system_baselines").delete().eq("system_id", systemId);
  await sb.from("chart_baseline_points").delete().eq("system_id", systemId);
  await sb.from("journal_baseline_days").delete().eq("system_id", systemId);
  await sb.from("cappers").delete().eq("system_id", systemId);

  // PERFORMANCE: every row is inserted in a single bulk statement per
  // table — the previous per-row loops (31 cappers + 379 days) blew
  // past Supabase's 8s statement timeout. Bulk inserts also collapse
  // per-row trigger reruns into one recompute pass per table (see
  // findings.md: "Postgres batches the trigger per-statement").
  //
  // We preserve the original IDs from the backup so we don't need to
  // remap foreign keys row-by-row. Safe because the wipe above
  // emptied every table for this system, and UUID collisions across
  // systems are vanishingly unlikely.

  const scalingRows = (data.scaling ?? []).map((r) => {
    const { id: _id, system_id: _sys, ...rest } = r as Record<string, unknown>;
    return { ...rest, system_id: systemId };
  });
  if (scalingRows.length) {
    const { error } = await sb.from("scaling_log_entries").insert(scalingRows);
    if (error) return { ok: false, error: error.message };
  }

  const capperRows = (data.cappers ?? []).map((c) => ({
    id: c.id,
    system_id: systemId,
    name: c.name,
    base_system_risk_units: c.base_system_risk_units,
    is_active: c.is_active,
    is_archived: c.is_archived,
    is_deleted: c.is_deleted ?? false,
    is_testing: c.is_testing ?? false,
    current_phase: c.current_phase,
    checklist_status: c.checklist_status,
    sort_order: c.sort_order ?? 0,
    notes: c.notes ?? null,
  }));
  if (capperRows.length) {
    const { error } = await sb.from("cappers").insert(capperRows);
    if (error) return { ok: false, error: error.message };
  }
  const validCapperIds = new Set(capperRows.map((c) => c.id));

  const dayRows = (data.capper_days ?? [])
    .filter((d) => validCapperIds.has(d.capper_id))
    .map((d) => ({
      id: d.id,
      capper_id: d.capper_id,
      system_id: systemId,
      date: d.date,
      entry_mode: d.entry_mode,
      wager_total: d.wager_total,
      bet_count: d.bet_count,
      daily_amount_pnl: d.daily_amount_pnl,
      wins: d.wins,
      losses: d.losses,
      unit_size_used: d.unit_size_used,
      excluded_from_system: d.excluded_from_system ?? false,
      notes: d.notes ?? null,
    }));
  if (dayRows.length) {
    const { error } = await sb.from("capper_day_entries").insert(dayRows);
    if (error) return { ok: false, error: error.message };
  }
  const validDayIds = new Set(dayRows.map((d) => d.id));

  const betRows: Array<Record<string, unknown>> = [];
  for (const b of data.capper_bets ?? []) {
    if (!validDayIds.has(b.capper_day_entry_id)) continue;
    if (!validCapperIds.has(b.capper_id)) continue;
    betRows.push({
      capper_day_entry_id: b.capper_day_entry_id,
      capper_id: b.capper_id,
      system_id: systemId,
      date: b.date,
      wager_amount: b.wager_amount,
      odds: b.odds,
      bet_result: b.bet_result,
      amount_pnl: b.amount_pnl,
      units_risk_multiplier: b.units_risk_multiplier,
      notes: b.notes ?? null,
      sport: b.sport ?? null,
    });
  }
  if (betRows.length) {
    const { error } = await sb.from("capper_bet_entries").insert(betRows);
    if (error) return { ok: false, error: error.message };
  }

  const baselineRows: Array<Record<string, unknown>> = [];
  for (const bl of data.capper_baselines ?? []) {
    if (!validCapperIds.has(bl.capper_id)) continue;
    baselineRows.push({
      capper_id: bl.capper_id,
      system_id: systemId,
      total_betting_days: bl.total_betting_days,
      total_bets: bl.total_bets,
      total_risk: bl.total_risk,
      cumulative_amount_pnl: bl.cumulative_amount_pnl,
      cumulative_units_pnl: bl.cumulative_units_pnl,
      wins: bl.wins,
      losses: bl.losses,
      green_day_count: bl.green_day_count,
      red_day_count: bl.red_day_count,
      green_day_roi_cumulative: bl.green_day_roi_cumulative,
      red_day_roi_cumulative: bl.red_day_roi_cumulative,
      running_roi_percent: bl.running_roi_percent,
      win_rate_percent: bl.win_rate_percent,
      green_day_avg_roi: bl.green_day_avg_roi,
      red_day_avg_roi: bl.red_day_avg_roi,
      green_day_probability: bl.green_day_probability,
      current_streak_value: bl.current_streak_value,
      current_streak_type: bl.current_streak_type,
      max_win_streak: bl.max_win_streak,
      max_loss_streak: bl.max_loss_streak,
      streak_breakdown: bl.streak_breakdown ?? [],
      notes: bl.notes ?? null,
    });
  }
  if (baselineRows.length) {
    const { error } = await sb.from("capper_baselines").insert(baselineRows);
    if (error) return { ok: false, error: error.message };
  }

  let systemBaselineImported = false;
  if (data.system_baseline) {
    const sb2 = data.system_baseline;
    const { error } = await sb.from("system_baselines").insert({
      system_id: systemId,
      total_betting_days: sb2.total_betting_days,
      total_bets: sb2.total_bets,
      total_risk: sb2.total_risk,
      cumulative_amount_pnl: sb2.cumulative_amount_pnl,
      cumulative_units_pnl: sb2.cumulative_units_pnl,
      wins: sb2.wins,
      losses: sb2.losses,
      green_day_count: sb2.green_day_count,
      red_day_count: sb2.red_day_count,
      green_day_roi_cumulative: sb2.green_day_roi_cumulative,
      red_day_roi_cumulative: sb2.red_day_roi_cumulative,
      running_roi_percent: sb2.running_roi_percent,
      win_rate_percent: sb2.win_rate_percent,
      green_day_avg_roi: sb2.green_day_avg_roi,
      red_day_avg_roi: sb2.red_day_avg_roi,
      green_day_probability: sb2.green_day_probability,
      max_win_streak: sb2.max_win_streak,
      max_loss_streak: sb2.max_loss_streak,
      streak_breakdown: sb2.streak_breakdown ?? [],
      notes: sb2.notes ?? null,
    });
    if (error) return { ok: false, error: error.message };
    systemBaselineImported = true;
  }

  const chartPointRows: Array<Record<string, unknown>> = [];
  const seenByScope = new Map<string, Set<number>>();
  const incoming = (data.chart_baseline_points ?? []).slice().sort((a, b) => {
    const da = Number(a.day_number ?? 0);
    const db = Number(b.day_number ?? 0);
    return da - db;
  });
  for (const p of incoming) {
    if (!Number.isFinite(p.cumulative_units)) continue;
    const day = Number(p.day_number);
    if (!Number.isFinite(day) || day < 1) continue;
    let capperId: string | null = null;
    if (p.capper_id) {
      if (!validCapperIds.has(p.capper_id)) continue;
      capperId = p.capper_id;
    }
    const scopeKey = capperId ?? "__system__";
    let seen = seenByScope.get(scopeKey);
    if (!seen) {
      seen = new Set();
      seenByScope.set(scopeKey, seen);
    }
    if (seen.has(day)) continue;
    seen.add(day);
    chartPointRows.push({
      system_id: systemId,
      capper_id: capperId,
      day_number: Math.round(day),
      cumulative_units: p.cumulative_units,
      notes: p.notes ?? null,
    });
  }
  if (chartPointRows.length > 0) {
    const { error } = await sb.from("chart_baseline_points").insert(chartPointRows);
    if (error) return { ok: false, error: error.message };
  }

  const jbdRows: Array<Record<string, unknown>> = [];
  const jbdSeen = new Set<string>();
  for (const r of data.journal_baseline_days ?? []) {
    if (!r.date || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) continue;
    if (jbdSeen.has(r.date)) continue;
    jbdSeen.add(r.date);
    jbdRows.push({
      system_id: systemId,
      date: r.date,
      total_wager: Number(r.total_wager ?? 0),
      total_bets: Math.round(Number(r.total_bets ?? 0)),
      daily_amount_pnl: Number(r.daily_amount_pnl ?? 0),
      daily_units_pnl: Number(r.daily_units_pnl ?? 0),
      wins: Math.round(Number(r.wins ?? 0)),
      losses: Math.round(Number(r.losses ?? 0)),
      notes: r.notes ?? null,
    });
  }
  if (jbdRows.length > 0) {
    const { error } = await sb.from("journal_baseline_days").insert(jbdRows);
    if (error) return { ok: false, error: error.message };
  }

  return {
    ok: true,
    summary: {
      cappers: capperRows.length,
      days: dayRows.length,
      bets: betRows.length,
      baselines: baselineRows.length,
      system_baseline: systemBaselineImported,
      chart_points: chartPointRows.length,
      journal_baseline_days: jbdRows.length,
    },
  };
}
