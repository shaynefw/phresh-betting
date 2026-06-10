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

  await sb.from("scaling_log_entries").delete().eq("system_id", systemId);
  await sb.from("capper_bet_entries").delete().eq("system_id", systemId);
  await sb.from("capper_day_entries").delete().eq("system_id", systemId);
  await sb.from("capper_baselines").delete().eq("system_id", systemId);
  await sb.from("system_baselines").delete().eq("system_id", systemId);
  await sb.from("chart_baseline_points").delete().eq("system_id", systemId);
  await sb.from("journal_baseline_days").delete().eq("system_id", systemId);
  await sb.from("cappers").delete().eq("system_id", systemId);

  const capperIdMap = new Map<string, string>();
  const dayIdMap = new Map<string, string>();

  const scalingRows = (data.scaling ?? []).map((r) => {
    const { id: _id, system_id: _sys, ...rest } = r as Record<string, unknown>;
    return { ...rest, system_id: systemId };
  });
  if (scalingRows.length) {
    const { error } = await sb.from("scaling_log_entries").insert(scalingRows);
    if (error) return { ok: false, error: error.message };
  }

  for (const c of data.cappers ?? []) {
    const { data: ins, error } = await sb
      .from("cappers")
      .insert({
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
      })
      .select("id")
      .single();
    if (error || !ins) return { ok: false, error: error?.message ?? "capper insert failed" };
    capperIdMap.set(c.id, ins.id);
  }

  for (const d of data.capper_days ?? []) {
    const newCapperId = capperIdMap.get(d.capper_id);
    if (!newCapperId) continue;
    const { data: ins, error } = await sb
      .from("capper_day_entries")
      .insert({
        capper_id: newCapperId,
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
      })
      .select("id")
      .single();
    if (error || !ins) return { ok: false, error: error?.message ?? "day insert failed" };
    dayIdMap.set(d.id, ins.id);
  }

  const betRows: Array<Record<string, unknown>> = [];
  for (const b of data.capper_bets ?? []) {
    const newDay = dayIdMap.get(b.capper_day_entry_id);
    const newCapper = capperIdMap.get(b.capper_id);
    if (!newDay || !newCapper) continue;
    betRows.push({
      capper_day_entry_id: newDay,
      capper_id: newCapper,
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
    const newCapperId = capperIdMap.get(bl.capper_id);
    if (!newCapperId) continue;
    baselineRows.push({
      capper_id: newCapperId,
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
    let newCapperId: string | null = null;
    if (p.capper_id) {
      newCapperId = capperIdMap.get(p.capper_id) ?? null;
      if (!newCapperId) continue;
    }
    const scopeKey = newCapperId ?? "__system__";
    let seen = seenByScope.get(scopeKey);
    if (!seen) {
      seen = new Set();
      seenByScope.set(scopeKey, seen);
    }
    if (seen.has(day)) continue;
    seen.add(day);
    chartPointRows.push({
      system_id: systemId,
      capper_id: newCapperId,
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
      cappers: capperIdMap.size,
      days: dayIdMap.size,
      bets: betRows.length,
      baselines: baselineRows.length,
      system_baseline: systemBaselineImported,
      chart_points: chartPointRows.length,
      journal_baseline_days: jbdRows.length,
    },
  };
}
