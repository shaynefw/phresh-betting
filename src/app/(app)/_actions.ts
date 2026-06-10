"use server";

import { revalidatePath } from "next/cache";
import { getUserId } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

async function ownsSystem(systemId: string): Promise<string | null> {
  const userId = await getUserId();
  if (!userId) return null;
  const sb = createAdminClient();
  const { data } = await sb
    .from("systems")
    .select("id")
    .eq("id", systemId)
    .eq("user_id", userId)
    .maybeSingle();
  return data ? userId : null;
}

export async function upsertCapperDay(input: {
  capperId: string;
  systemId: string;
  date: string;
  entry_mode: "daily_totals" | "bet_level";
  wager_total: number;
  bet_count: number;
  daily_amount_pnl: number;
  wins: number;
  losses: number;
}) {
  if (!(await ownsSystem(input.systemId))) {
    return { error: "Access denied" };
  }
  const sb = createAdminClient();
  const { error } = await sb.from("capper_day_entries").upsert(
    {
      capper_id: input.capperId,
      system_id: input.systemId,
      date: input.date,
      entry_mode: input.entry_mode,
      wager_total: input.wager_total,
      bet_count: input.bet_count,
      daily_amount_pnl: input.daily_amount_pnl,
      wins: input.wins,
      losses: input.losses,
    },
    { onConflict: "capper_id,date" },
  );
  if (error) return { error: error.message };
  revalidatePath(`/cappers/${input.capperId}`);
  revalidatePath("/cappers");
  revalidatePath("/dashboard");
  revalidatePath("/journal");
  revalidatePath("/bets");
  return { ok: true };
}

export async function addBet(input: {
  capperDayEntryId: string;
  capperId: string;
  systemId: string;
  date: string;
  wager_amount: number;
  odds: number | null;
  bet_result: "win" | "loss" | "void" | "pending";
  // For 'pending' bets PnL is not known yet — caller passes 0. The DB
  // recompute_capper() filters pending out of every aggregate, so the 0
  // never actually contributes to wager_total / daily_amount_pnl / etc.
  amount_pnl: number;
  notes: string | null;
  /** Sport tag — null if user hasn't selected one yet. */
  sport: string | null;
}) {
  if (!(await ownsSystem(input.systemId))) {
    return { error: "Access denied" };
  }
  const sb = createAdminClient();
  const { error } = await sb.from("capper_bet_entries").insert({
    capper_day_entry_id: input.capperDayEntryId,
    capper_id: input.capperId,
    system_id: input.systemId,
    date: input.date,
    wager_amount: input.wager_amount,
    odds: input.odds,
    bet_result: input.bet_result,
    amount_pnl: input.amount_pnl,
    notes: input.notes,
    sport: input.sport,
  });
  if (error) return { error: error.message };
  revalidatePath(`/cappers/${input.capperId}`);
  revalidatePath("/cappers");
  revalidatePath("/dashboard");
  revalidatePath("/journal");
  revalidatePath("/bets");
  return { ok: true };
}

export async function upsertCapperBaseline(input: {
  capperId: string;
  systemId: string;
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
  streak_breakdown: Array<{ type: "green" | "red"; length: number; count: number }>;
  notes: string | null;
}) {
  if (!(await ownsSystem(input.systemId))) {
    return { error: "Access denied" };
  }
  const sb = createAdminClient();
  const { error } = await sb.from("capper_baselines").upsert(
    {
      capper_id: input.capperId,
      system_id: input.systemId,
      total_betting_days: input.total_betting_days,
      total_bets: input.total_bets,
      total_risk: input.total_risk,
      cumulative_amount_pnl: input.cumulative_amount_pnl,
      cumulative_units_pnl: input.cumulative_units_pnl,
      wins: input.wins,
      losses: input.losses,
      green_day_count: input.green_day_count,
      red_day_count: input.red_day_count,
      green_day_roi_cumulative: input.green_day_roi_cumulative,
      red_day_roi_cumulative: input.red_day_roi_cumulative,
      running_roi_percent: input.running_roi_percent,
      win_rate_percent: input.win_rate_percent,
      green_day_avg_roi: input.green_day_avg_roi,
      red_day_avg_roi: input.red_day_avg_roi,
      green_day_probability: input.green_day_probability,
      current_streak_value: input.current_streak_value,
      current_streak_type: input.current_streak_type,
      max_win_streak: input.max_win_streak,
      max_loss_streak: input.max_loss_streak,
      streak_breakdown: input.streak_breakdown,
      notes: input.notes,
    },
    { onConflict: "capper_id" },
  );
  if (error) return { error: error.message };
  revalidatePath(`/cappers/${input.capperId}`);
  revalidatePath("/cappers");
  return { ok: true };
}

export async function upsertSystemBaseline(input: {
  systemId: string;
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
  streak_breakdown: Array<{ type: "green" | "red"; length: number; count: number }>;
  notes: string | null;
}) {
  if (!(await ownsSystem(input.systemId))) {
    return { error: "Access denied" };
  }
  const sb = createAdminClient();
  const { error } = await sb.from("system_baselines").upsert(
    {
      system_id: input.systemId,
      total_betting_days: input.total_betting_days,
      total_bets: input.total_bets,
      total_risk: input.total_risk,
      cumulative_amount_pnl: input.cumulative_amount_pnl,
      cumulative_units_pnl: input.cumulative_units_pnl,
      wins: input.wins,
      losses: input.losses,
      green_day_count: input.green_day_count,
      red_day_count: input.red_day_count,
      green_day_roi_cumulative: input.green_day_roi_cumulative,
      red_day_roi_cumulative: input.red_day_roi_cumulative,
      running_roi_percent: input.running_roi_percent,
      win_rate_percent: input.win_rate_percent,
      green_day_avg_roi: input.green_day_avg_roi,
      red_day_avg_roi: input.red_day_avg_roi,
      green_day_probability: input.green_day_probability,
      max_win_streak: input.max_win_streak,
      max_loss_streak: input.max_loss_streak,
      streak_breakdown: input.streak_breakdown,
      notes: input.notes,
    },
    { onConflict: "system_id" },
  );
  if (error) return { error: error.message };
  revalidatePath("/dashboard");
  revalidatePath("/settings");
  return { ok: true };
}

/**
 * Replace the journal_baseline_days for a system with a new set.
 * Atomic-ish: deletes everything for the system first, then inserts
 * the new rows. The DB trigger fires recompute_journal once per
 * write — Postgres batches the trigger per-statement so even a 100-
 * row insert only triggers one recompute pass.
 *
 * Each row must have a valid YYYY-MM-DD date. Wager / bets / pnl /
 * units / wins / losses default to 0 if missing or invalid; notes
 * are optional. The (system_id, date) unique constraint means
 * duplicate dates in the input are silently collapsed by the dedupe
 * pass below — the first occurrence of each date wins.
 */
export async function replaceJournalBaseline(input: {
  systemId: string;
  rows: Array<{
    date: string;
    total_wager?: number;
    total_bets?: number;
    daily_amount_pnl?: number;
    daily_units_pnl?: number;
    wins?: number;
    losses?: number;
    notes?: string | null;
  }>;
}) {
  if (!(await ownsSystem(input.systemId))) {
    return { error: "Access denied" };
  }
  const sb = createAdminClient();

  // Dedupe by date — keep the first occurrence.
  const seen = new Set<string>();
  const cleaned: Array<Record<string, unknown>> = [];
  for (const r of input.rows) {
    if (!r.date || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) continue;
    if (seen.has(r.date)) continue;
    seen.add(r.date);
    const totalWager = Number(r.total_wager ?? 0);
    const totalBets = Math.round(Number(r.total_bets ?? 0));
    const amtPnl = Number(r.daily_amount_pnl ?? 0);
    const unitsPnl = Number(r.daily_units_pnl ?? 0);
    const wins = Math.round(Number(r.wins ?? 0));
    const losses = Math.round(Number(r.losses ?? 0));
    if (
      !Number.isFinite(totalWager) ||
      !Number.isFinite(amtPnl) ||
      !Number.isFinite(unitsPnl)
    ) {
      continue;
    }
    cleaned.push({
      system_id: input.systemId,
      date: r.date,
      total_wager: totalWager,
      total_bets: totalBets,
      daily_amount_pnl: amtPnl,
      daily_units_pnl: unitsPnl,
      wins,
      losses,
      notes: r.notes ?? null,
    });
  }

  // Wipe + reinsert. The jbd_after trigger fires recompute_journal
  // automatically, so the journal table is rebuilt before this
  // action returns.
  const { error: delErr } = await sb
    .from("journal_baseline_days")
    .delete()
    .eq("system_id", input.systemId);
  if (delErr) return { error: delErr.message };
  if (cleaned.length > 0) {
    const { error } = await sb.from("journal_baseline_days").insert(cleaned);
    if (error) return { error: error.message };
  }

  revalidatePath("/journal");
  revalidatePath("/dashboard");
  return { ok: true, count: cleaned.length };
}

export async function clearJournalBaseline(systemId: string) {
  if (!(await ownsSystem(systemId))) return { error: "Access denied" };
  const sb = createAdminClient();
  const { error } = await sb
    .from("journal_baseline_days")
    .delete()
    .eq("system_id", systemId);
  if (error) return { error: error.message };
  revalidatePath("/journal");
  revalidatePath("/dashboard");
  return { ok: true };
}

/**
 * Upsert a single Daily Betting Journal baseline row from the manual
 * entry form. Dollar tracking and unit tracking are stored as fully
 * independent inputs — Cum $ accumulates from `daily_amount_pnl` and
 * Cum Units accumulates from `daily_units_pnl`. Neither is derived
 * from the other; the user types both directly.
 *
 * Conflict on (system_id, date) updates in place. The DB trigger then
 * re-runs recompute_journal once and the Daily Betting Journal table
 * rebuilds with the new baseline cascaded into every later row's
 * Cum $ / Cum Units / Run ROI / Streak.
 */
export async function upsertJournalBaselineDay(input: {
  systemId: string;
  date: string;
  total_bets: number;
  total_wager: number;
  daily_amount_pnl: number;
  /** Direct manual input — NOT derived from daily_amount_pnl. */
  daily_units_pnl: number;
  wins: number;
  losses: number;
  notes?: string | null;
}) {
  if (!(await ownsSystem(input.systemId))) return { error: "Access denied" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    return { error: "Invalid date — expected YYYY-MM-DD" };
  }
  const sb = createAdminClient();

  const pnl = Number(input.daily_amount_pnl);
  const units = Number(input.daily_units_pnl);

  const { error } = await sb
    .from("journal_baseline_days")
    .upsert(
      {
        system_id: input.systemId,
        date: input.date,
        total_bets: Math.max(0, Math.round(Number(input.total_bets) || 0)),
        total_wager: Math.max(0, Number(input.total_wager) || 0),
        daily_amount_pnl: Number.isFinite(pnl) ? pnl : 0,
        daily_units_pnl: Number.isFinite(units) ? units : 0,
        wins: Math.max(0, Math.round(Number(input.wins) || 0)),
        losses: Math.max(0, Math.round(Number(input.losses) || 0)),
        notes: input.notes ?? null,
      },
      { onConflict: "system_id,date" },
    );
  if (error) return { error: error.message };

  revalidatePath("/journal");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function deleteJournalBaselineDay(input: {
  systemId: string;
  date: string;
}) {
  if (!(await ownsSystem(input.systemId))) return { error: "Access denied" };
  const sb = createAdminClient();
  const { error } = await sb
    .from("journal_baseline_days")
    .delete()
    .eq("system_id", input.systemId)
    .eq("date", input.date);
  if (error) return { error: error.message };
  revalidatePath("/journal");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function clearSystemBaseline(systemId: string) {
  if (!(await ownsSystem(systemId))) return { error: "Access denied" };
  const sb = createAdminClient();
  const { error } = await sb.from("system_baselines").delete().eq("system_id", systemId);
  if (error) return { error: error.message };
  revalidatePath("/dashboard");
  revalidatePath("/settings");
  return { ok: true };
}

export async function toggleCapperTesting(
  capperId: string,
  systemId: string,
  isTesting: boolean,
) {
  if (!(await ownsSystem(systemId))) return { error: "Access denied" };
  const sb = createAdminClient();
  const { error } = await sb
    .from("cappers")
    .update({ is_testing: isTesting })
    .eq("id", capperId)
    .eq("system_id", systemId);
  if (error) return { error: error.message };
  revalidatePath(`/cappers/${capperId}`);
  revalidatePath("/cappers");
  revalidatePath("/dashboard");
  revalidatePath("/journal");
  return { ok: true };
}

export async function replaceChartBaselinePoints(input: {
  systemId: string;
  capperId: string | null;
  points: Array<{ day_number: number; cumulative_units: number; notes?: string | null }>;
}) {
  if (!(await ownsSystem(input.systemId))) {
    return { error: "Access denied" };
  }
  const sb = createAdminClient();
  let del = sb.from("chart_baseline_points").delete().eq("system_id", input.systemId);
  del = input.capperId === null
    ? del.is("capper_id", null)
    : del.eq("capper_id", input.capperId);
  const { error: delErr } = await del;
  if (delErr) return { error: delErr.message };

  if (input.points.length > 0) {
    const rows = input.points
      .filter(
        (p) =>
          Number.isFinite(p.day_number) &&
          p.day_number >= 1 &&
          Number.isFinite(p.cumulative_units),
      )
      .map((p) => ({
        system_id: input.systemId,
        capper_id: input.capperId,
        day_number: Math.round(Number(p.day_number)),
        cumulative_units: p.cumulative_units,
        notes: p.notes ?? null,
      }));
    if (rows.length > 0) {
      const { error } = await sb.from("chart_baseline_points").insert(rows);
      if (error) return { error: error.message };
    }
  }

  revalidatePath("/dashboard");
  revalidatePath("/cappers");
  if (input.capperId) revalidatePath(`/cappers/${input.capperId}`);
  return { ok: true };
}

export async function clearCapperBaseline(capperId: string, systemId: string) {
  if (!(await ownsSystem(systemId))) return { error: "Access denied" };
  const sb = createAdminClient();
  const { error } = await sb.from("capper_baselines").delete().eq("capper_id", capperId);
  if (error) return { error: error.message };
  revalidatePath(`/cappers/${capperId}`);
  revalidatePath("/cappers");
  return { ok: true };
}

export async function deleteBet(betId: string, systemId: string, capperId: string) {
  if (!(await ownsSystem(systemId))) {
    return { error: "Access denied" };
  }
  const sb = createAdminClient();
  const { error } = await sb.from("capper_bet_entries").delete().eq("id", betId);
  if (error) return { error: error.message };
  revalidatePath(`/cappers/${capperId}`);
  revalidatePath("/dashboard");
  revalidatePath("/journal");
  revalidatePath("/bets");
  return { ok: true };
}

export async function updateBet(input: {
  betId: string;
  capperId: string;
  systemId: string;
  wager_amount: number;
  odds: number | null;
  bet_result: "win" | "loss" | "void" | "pending";
  amount_pnl: number;
  notes: string | null;
  /** Sport tag — pass null to clear; this is the retroactive-tagging path. */
  sport: string | null;
}) {
  if (!(await ownsSystem(input.systemId))) {
    return { error: "Access denied" };
  }
  const sb = createAdminClient();
  // The trg_after_cbe trigger fires on UPDATE and auto-recomputes capper
  // rollups + journal, so no extra recompute work is needed here.
  const { error } = await sb
    .from("capper_bet_entries")
    .update({
      wager_amount: input.wager_amount,
      odds: input.odds,
      bet_result: input.bet_result,
      amount_pnl: input.amount_pnl,
      notes: input.notes,
      sport: input.sport,
    })
    .eq("id", input.betId)
    .eq("system_id", input.systemId);
  if (error) return { error: error.message };
  revalidatePath(`/cappers/${input.capperId}`);
  revalidatePath("/cappers");
  revalidatePath("/dashboard");
  revalidatePath("/journal");
  revalidatePath("/bets");
  return { ok: true };
}

