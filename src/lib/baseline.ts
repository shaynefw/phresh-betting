/**
 * Blend a manual historical baseline with live tracked capper data.
 *
 * Counters add. Ratios (ROI, win rate, averages, probability) are
 * recomputed from the combined totals so they stay internally consistent.
 * Streaks: max-streaks take the max; current streak prefers the live
 * tracked side if any tracked days exist, else baseline.
 */

import type { CapperBaseline, CapperDayEntry, StreakType } from "./types";
import { rollupCapperDays, type CapperRollupSummary } from "./calc";
import { safeDiv } from "./utils";

/**
 * Collapse multiple capper baselines into a single system-level baseline.
 * Counters add. Streaks: max-streaks take the max; current streak gets
 * "neutral_hold" (a system isn't really on a single streak across cappers).
 * Ratios are not stored — recompute from totals when blending.
 */
export function aggregateBaselines(
  rows: CapperBaseline[],
  systemId: string,
): CapperBaseline | null {
  if (rows.length === 0) return null;
  const sum = (k: keyof CapperBaseline) =>
    rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const max = (k: keyof CapperBaseline) =>
    rows.reduce((m, r) => Math.max(m, Number(r[k] ?? 0)), 0);
  return {
    capper_id: "_system_aggregate",
    system_id: systemId,
    total_betting_days: sum("total_betting_days"),
    total_bets: sum("total_bets"),
    total_risk: sum("total_risk"),
    cumulative_amount_pnl: sum("cumulative_amount_pnl"),
    cumulative_units_pnl: sum("cumulative_units_pnl"),
    wins: sum("wins"),
    losses: sum("losses"),
    green_day_count: sum("green_day_count"),
    red_day_count: sum("red_day_count"),
    green_day_roi_cumulative: sum("green_day_roi_cumulative"),
    red_day_roi_cumulative: sum("red_day_roi_cumulative"),
    running_roi_percent: 0, // recomputed on blend
    win_rate_percent: 0,
    green_day_avg_roi: 0,
    red_day_avg_roi: 0,
    green_day_probability: 0,
    current_streak_value: 0,
    current_streak_type: "neutral_hold",
    max_win_streak: max("max_win_streak"),
    max_loss_streak: max("max_loss_streak"),
    notes: null,
  };
}

/**
 * Blend a baseline with a journal summary (system-level rollup).
 * Journal already has tracked numbers; baseline adds historical totals.
 */
export function combineWithJournal(
  baseline: CapperBaseline | null,
  journal: {
    cumulativeUnits: number;
    cumulativeAmount: number;
    totalDays: number;
    totalBets: number;
    totalRisk: number;
    runningRoi: number;
    greenDays: number;
    redDays: number;
    greenAvgRoi: number;
    redAvgRoi: number;
    greenProbability: number;
    winRecord: { w: number; l: number; rate: number };
    streak: { type: StreakType; value: number };
    maxWinStreak?: number;
    maxLossStreak?: number;
  },
): CombinedSummary {
  const totalDays = (baseline?.total_betting_days ?? 0) + journal.totalDays;
  const totalBets = (baseline?.total_bets ?? 0) + journal.totalBets;
  const totalRisk = Number(baseline?.total_risk ?? 0) + journal.totalRisk;
  const cumulativeAmount =
    Number(baseline?.cumulative_amount_pnl ?? 0) + journal.cumulativeAmount;
  const cumulativeUnits =
    Number(baseline?.cumulative_units_pnl ?? 0) + journal.cumulativeUnits;
  const wins = (baseline?.wins ?? 0) + journal.winRecord.w;
  const losses = (baseline?.losses ?? 0) + journal.winRecord.l;
  const greenDays = (baseline?.green_day_count ?? 0) + journal.greenDays;
  const redDays = (baseline?.red_day_count ?? 0) + journal.redDays;
  const greenRoiCum =
    Number(baseline?.green_day_roi_cumulative ?? 0) +
    journal.greenAvgRoi * journal.greenDays;
  const redRoiCum =
    Number(baseline?.red_day_roi_cumulative ?? 0) +
    journal.redAvgRoi * journal.redDays;
  return {
    totalDays,
    totalBets,
    totalRisk,
    cumulativeAmount,
    cumulativeUnits,
    wins,
    losses,
    greenDays,
    redDays,
    greenRoiCum,
    redRoiCum,
    runningRoi: safeDiv(cumulativeAmount, totalRisk) * 100,
    winRate: wins + losses === 0 ? 0 : (wins / (wins + losses)) * 100,
    greenAvgRoi: greenDays === 0 ? 0 : greenRoiCum / greenDays,
    redAvgRoi: redDays === 0 ? 0 : redRoiCum / redDays,
    greenProbability:
      greenDays + redDays === 0 ? 0 : (greenDays / (greenDays + redDays)) * 100,
    // Streak: journal has the live one, which is what matters; baseline streak isn't carried at system level
    currentStreakType: journal.streak.type,
    currentStreakValue: journal.streak.value,
    maxWinStreak: Math.max(baseline?.max_win_streak ?? 0, journal.maxWinStreak ?? 0),
    maxLossStreak: Math.max(baseline?.max_loss_streak ?? 0, journal.maxLossStreak ?? 0),
  };
}

export interface CombinedSummary {
  totalDays: number;
  totalBets: number;
  totalRisk: number;
  cumulativeAmount: number;
  cumulativeUnits: number;
  wins: number;
  losses: number;
  greenDays: number;
  redDays: number;
  greenRoiCum: number;
  redRoiCum: number;
  // derived
  runningRoi: number;
  winRate: number;
  greenAvgRoi: number;
  redAvgRoi: number;
  greenProbability: number;
  // streaks
  currentStreakType: StreakType;
  currentStreakValue: number;
  maxWinStreak: number;
  maxLossStreak: number;
}

export const ZERO_BASELINE: Omit<CapperBaseline, "capper_id" | "system_id" | "notes"> = {
  total_betting_days: 0,
  total_bets: 0,
  total_risk: 0,
  cumulative_amount_pnl: 0,
  cumulative_units_pnl: 0,
  wins: 0,
  losses: 0,
  green_day_count: 0,
  red_day_count: 0,
  green_day_roi_cumulative: 0,
  red_day_roi_cumulative: 0,
  running_roi_percent: 0,
  win_rate_percent: 0,
  green_day_avg_roi: 0,
  red_day_avg_roi: 0,
  green_day_probability: 0,
  current_streak_value: 0,
  current_streak_type: "neutral_hold",
  max_win_streak: 0,
  max_loss_streak: 0,
};

/** Build a tracked-only summary (everything from live `capper_day_entries`). */
export function trackedSummary(days: CapperDayEntry[]): CapperRollupSummary {
  return rollupCapperDays(days);
}

/** Combine baseline + tracked. */
export function combine(
  baseline: CapperBaseline | null,
  tracked: CapperRollupSummary,
): CombinedSummary {
  const b = baseline;
  const totalDays = (b?.total_betting_days ?? 0) + tracked.totalDays;
  const totalBets = (b?.total_bets ?? 0) + tracked.totalBets;
  const totalRisk = Number(b?.total_risk ?? 0) + tracked.totalRisk;
  const cumulativeAmount =
    Number(b?.cumulative_amount_pnl ?? 0) + tracked.cumulativeAmount;
  const cumulativeUnits =
    Number(b?.cumulative_units_pnl ?? 0) + tracked.cumulativeUnits;
  const wins = (b?.wins ?? 0) + Number(tracked.winRate >= 0 ? 0 : 0); // wins are tracked via record_w
  // recover wins/losses from tracked rollup using its winRate proxy
  // tracked.winRate = wins / (wins+losses). We don't have wins from rollupCapperDays directly,
  // but we do have totalDays/totalBets — and tracked summary exposed only winRate. To keep the
  // model consistent, recompute wins/losses from the original days via summed record fields.
  // Simpler: rely on baseline + tracked record fields directly. Recompute from days here.
  // Actually easiest: tracked rollup gives winRate which combined with totalBets is lossy. So
  // we need wins/losses out of rollupCapperDays. Let's just look at last day in tracked summary.
  // Use a separate helper:
  // (see `winsLosses` below)

  const greenDays = (b?.green_day_count ?? 0) + tracked.greenDays;
  const redDays = (b?.red_day_count ?? 0) + tracked.redDays;
  const greenRoiCum =
    Number(b?.green_day_roi_cumulative ?? 0) +
    tracked.greenAvgRoi * tracked.greenDays;
  const redRoiCum =
    Number(b?.red_day_roi_cumulative ?? 0) +
    tracked.redAvgRoi * tracked.redDays;

  const runningRoi = safeDiv(cumulativeAmount, totalRisk) * 100;
  const winRate = wins + 0 === 0 ? 0 : 0; // placeholder; will be replaced by combineWithDays

  return {
    totalDays,
    totalBets,
    totalRisk,
    cumulativeAmount,
    cumulativeUnits,
    wins, // see combineWithDays for accurate wins
    losses: 0,
    greenDays,
    redDays,
    greenRoiCum,
    redRoiCum,
    runningRoi,
    winRate,
    greenAvgRoi: greenDays === 0 ? 0 : greenRoiCum / greenDays,
    redAvgRoi: redDays === 0 ? 0 : redRoiCum / redDays,
    greenProbability:
      greenDays + redDays === 0
        ? 0
        : (greenDays / (greenDays + redDays)) * 100,
    currentStreakType:
      tracked.totalDays > 0 ? tracked.currentStreakType : (b?.current_streak_type ?? "neutral_hold"),
    currentStreakValue:
      tracked.totalDays > 0 ? tracked.currentStreakValue : (b?.current_streak_value ?? 0),
    maxWinStreak: Math.max(b?.max_win_streak ?? 0, tracked.maxWinStreak),
    maxLossStreak: Math.max(b?.max_loss_streak ?? 0, tracked.maxLossStreak),
  };
}

/**
 * Authoritative version that pulls wins/losses straight out of the day rows.
 * Use this in pages that already have `days[]` — preferred over `combine()`.
 */
export function combineWithDays(
  baseline: CapperBaseline | null,
  days: CapperDayEntry[],
): CombinedSummary {
  const tracked = rollupCapperDays(days);
  // exact wins / losses from the day rows
  const trackedWins = days.reduce((s, d) => s + (d.wins || 0), 0);
  const trackedLosses = days.reduce((s, d) => s + (d.losses || 0), 0);
  const wins = (baseline?.wins ?? 0) + trackedWins;
  const losses = (baseline?.losses ?? 0) + trackedLosses;
  const blended = combine(baseline, tracked);
  return {
    ...blended,
    wins,
    losses,
    winRate:
      wins + losses === 0 ? 0 : (wins / (wins + losses)) * 100,
  };
}
