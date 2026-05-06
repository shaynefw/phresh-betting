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
  return { ok: true };
}

export async function addBet(input: {
  capperDayEntryId: string;
  capperId: string;
  systemId: string;
  date: string;
  wager_amount: number;
  odds: number | null;
  bet_result: "win" | "loss" | "void";
  amount_pnl: number;
  notes: string | null;
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
  });
  if (error) return { error: error.message };
  revalidatePath(`/cappers/${input.capperId}`);
  revalidatePath("/cappers");
  revalidatePath("/dashboard");
  revalidatePath("/journal");
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
      notes: input.notes,
    },
    { onConflict: "capper_id" },
  );
  if (error) return { error: error.message };
  revalidatePath(`/cappers/${input.capperId}`);
  revalidatePath("/cappers");
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
  return { ok: true };
}

interface BackupPayload {
  system: { name: string };
  scaling: Array<Record<string, unknown>>;
  cappers: Array<{
    id: string;
    name: string;
    base_system_risk_units: number;
    is_active: boolean;
    is_archived: boolean;
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
  }>;
}

export async function importBackup(systemId: string, payloadJson: string) {
  if (!(await ownsSystem(systemId))) {
    return { error: "Access denied" };
  }
  let data: BackupPayload;
  try {
    data = JSON.parse(payloadJson);
  } catch {
    return { error: "Invalid JSON" };
  }
  if (!data?.system || !Array.isArray(data.scaling)) {
    return { error: "Unrecognized backup format" };
  }
  const sb = createAdminClient();

  await sb.from("scaling_log_entries").delete().eq("system_id", systemId);
  await sb.from("capper_bet_entries").delete().eq("system_id", systemId);
  await sb.from("capper_day_entries").delete().eq("system_id", systemId);
  await sb.from("cappers").delete().eq("system_id", systemId);

  const capperIdMap = new Map<string, string>();
  const dayIdMap = new Map<string, string>();

  const scalingRows = (data.scaling ?? []).map((r) => {
    const { id: _id, system_id: _sys, ...rest } = r;
    return { ...rest, system_id: systemId };
  });
  if (scalingRows.length) {
    const { error } = await sb.from("scaling_log_entries").insert(scalingRows);
    if (error) return { error: error.message };
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
        current_phase: c.current_phase,
        checklist_status: c.checklist_status,
        sort_order: c.sort_order ?? 0,
        notes: c.notes ?? null,
      })
      .select("id")
      .single();
    if (error || !ins) return { error: error?.message ?? "capper insert failed" };
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
        notes: d.notes ?? null,
      })
      .select("id")
      .single();
    if (error || !ins) return { error: error?.message ?? "day insert failed" };
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
    });
  }
  if (betRows.length) {
    const { error } = await sb.from("capper_bet_entries").insert(betRows);
    if (error) return { error: error.message };
  }

  revalidatePath("/dashboard");
  revalidatePath("/journal");
  revalidatePath("/cappers");
  revalidatePath("/settings");

  return {
    ok: true,
    summary: {
      cappers: capperIdMap.size,
      days: dayIdMap.size,
      bets: betRows.length,
    },
  };
}
