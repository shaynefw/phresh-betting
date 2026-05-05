/**
 * Centralized calculation utilities. Database stores authoritative rollups
 * via triggers (see 0002_recompute.sql). These helpers mirror the logic
 * for client-side previews and derived UI state (scaling progress, etc.).
 */

import type {
  CapperDayEntry,
  JournalDayEntry,
  ScalingLogEntry,
  ScalingState,
} from "./types";
import { safeDiv } from "./utils";

export const SCALE_BAND_UNITS = 25;
export const SCALE_FACTOR_UP = 1.25;
export const SCALE_FACTOR_DOWN = 0.75;

export function scaleSize(size: number, direction: "up" | "down"): number {
  return Math.round(size * (direction === "up" ? SCALE_FACTOR_UP : SCALE_FACTOR_DOWN));
}

/**
 * Compute scaling state given the latest journal cumulative units and the
 * current scaling log. The `bandStartUnits` is the cumulative-units value
 * recorded on the active scaling row's `starting_units_threshold` column,
 * defaulting to 0.
 */
export function computeScalingState(
  cumulativeUnits: number,
  activeRow: ScalingLogEntry | null,
): ScalingState {
  const currentUnitSize = activeRow?.unit_size_dollars ?? 0;
  const bandStart = Number(activeRow?.starting_units_threshold ?? 0);
  const scaleUpAt = bandStart + SCALE_BAND_UNITS;
  const scaleDownAt = bandStart - SCALE_BAND_UNITS;
  const unitsAboveBand = cumulativeUnits - bandStart;

  // progress to next scale-up event, capped 0..100
  const progress = Math.max(
    0,
    Math.min(100, (unitsAboveBand / SCALE_BAND_UNITS) * 100),
  );

  let pendingNextSize: number | undefined;
  let pendingDirection: "up" | "down" | undefined;
  if (cumulativeUnits >= scaleUpAt && currentUnitSize > 0) {
    pendingNextSize = scaleSize(currentUnitSize, "up");
    pendingDirection = "up";
  } else if (cumulativeUnits <= scaleDownAt && currentUnitSize > 0) {
    pendingNextSize = scaleSize(currentUnitSize, "down");
    pendingDirection = "down";
  }

  return {
    currentUnitSize,
    bandStartUnits: bandStart,
    unitsAboveBand,
    scaleUpAt,
    scaleDownAt,
    scaleUpProgressPct: progress,
    pendingNextSize,
    pendingDirection,
  };
}

/** Picks the latest scaling row whose effective_date <= `on`. */
export function activeScalingRow(
  rows: ScalingLogEntry[],
  on: string,
): ScalingLogEntry | null {
  const sorted = [...rows]
    .filter((r) => r.effective_date <= on)
    .sort((a, b) => (a.effective_date < b.effective_date ? 1 : -1));
  return sorted[0] ?? null;
}

/** Daily ROI from amount and wager. Returns 0 if wager=0. */
export function dailyRoi(amount: number, wager: number): number {
  return wager === 0 ? 0 : (amount / wager) * 100;
}

export function unitsFromAmount(amount: number, unitSize: number): number {
  return unitSize === 0 ? 0 : amount / unitSize;
}

export interface CapperRollupSummary {
  totalDays: number;
  totalBets: number;
  totalRisk: number;
  cumulativeAmount: number;
  cumulativeUnits: number;
  runningRoi: number;
  winRate: number;
  greenDays: number;
  redDays: number;
  greenAvgRoi: number;
  redAvgRoi: number;
  greenProbability: number;
  currentStreakType: "green" | "red" | "neutral_hold";
  currentStreakValue: number;
  maxWinStreak: number;
  maxLossStreak: number;
}

/**
 * Mirror of the SQL recompute pipeline for capper days. Used for offline
 * previews / debugging. The DB is authoritative.
 */
export function rollupCapperDays(
  days: CapperDayEntry[],
): CapperRollupSummary {
  let cumAmt = 0;
  let cumUnits = 0;
  let cumWager = 0;
  let recW = 0;
  let recL = 0;
  let green = 0;
  let red = 0;
  let greenRoi = 0;
  let redRoi = 0;
  let streakVal = 0;
  let streakType: "green" | "red" | "neutral_hold" = "neutral_hold";
  let maxWin = 0;
  let maxLoss = 0;
  const sorted = [...days].sort((a, b) => (a.date < b.date ? -1 : 1));
  for (const d of sorted) {
    const roi = dailyRoi(d.daily_amount_pnl, d.wager_total);
    cumAmt += d.daily_amount_pnl;
    cumUnits += d.daily_units_pnl;
    cumWager += d.wager_total;
    recW += d.wins;
    recL += d.losses;
    if (roi > 0) {
      green++;
      greenRoi += roi;
      streakVal = streakType === "green" ? streakVal + 1 : 1;
      streakType = "green";
      maxWin = Math.max(maxWin, streakVal);
    } else if (roi < 0) {
      red++;
      redRoi += roi;
      streakVal = streakType === "red" ? streakVal + 1 : 1;
      streakType = "red";
      maxLoss = Math.max(maxLoss, streakVal);
    }
  }
  return {
    totalDays: sorted.length,
    totalBets: sorted.reduce((s, d) => s + d.bet_count, 0),
    totalRisk: cumWager,
    cumulativeAmount: cumAmt,
    cumulativeUnits: cumUnits,
    runningRoi: safeDiv(cumAmt, cumWager) * 100,
    winRate: recW + recL === 0 ? 0 : (recW / (recW + recL)) * 100,
    greenDays: green,
    redDays: red,
    greenAvgRoi: green === 0 ? 0 : greenRoi / green,
    redAvgRoi: red === 0 ? 0 : redRoi / red,
    greenProbability:
      green + red === 0 ? 0 : (green / (green + red)) * 100,
    currentStreakType: streakType,
    currentStreakValue: streakVal,
    maxWinStreak: maxWin,
    maxLossStreak: maxLoss,
  };
}

export function summarizeJournal(journal: JournalDayEntry[]): {
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
  streak: { type: "green" | "red" | "neutral_hold"; value: number };
} {
  if (journal.length === 0) {
    return {
      cumulativeUnits: 0,
      cumulativeAmount: 0,
      totalDays: 0,
      totalBets: 0,
      totalRisk: 0,
      runningRoi: 0,
      greenDays: 0,
      redDays: 0,
      greenAvgRoi: 0,
      redAvgRoi: 0,
      greenProbability: 0,
      winRecord: { w: 0, l: 0, rate: 0 },
      streak: { type: "neutral_hold", value: 0 },
    };
  }
  const last = journal[journal.length - 1];
  return {
    cumulativeUnits: last.cumulative_units_pnl,
    cumulativeAmount: last.cumulative_amount_pnl,
    totalDays: journal.length,
    totalBets: journal.reduce((s, j) => s + j.total_bets, 0),
    totalRisk: last.total_system_risk_cumulative,
    runningRoi: last.running_roi_percent,
    greenDays: last.green_day_count,
    redDays: last.red_day_count,
    greenAvgRoi: last.green_day_avg_roi,
    redAvgRoi: last.red_day_avg_roi,
    greenProbability: last.green_day_probability,
    winRecord: {
      w: last.record_wins,
      l: last.record_losses,
      rate:
        last.record_wins + last.record_losses === 0
          ? 0
          : (last.record_wins / (last.record_wins + last.record_losses)) * 100,
    },
    streak: { type: last.current_streak_type, value: last.current_streak_value },
  };
}
