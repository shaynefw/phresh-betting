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
 * current scaling log row.
 *
 * The active scaling row's two thresholds define the band the user is
 * currently inside:
 *   - `starting_units_threshold` = lower band (scale-DOWN trigger)
 *   - `ending_units_threshold`   = upper band (scale-UP trigger)
 *
 * The progress bar maps the band to 0..100%:
 *   progress % = (cumulative - lower) / (upper - lower) * 100
 *
 * 0%   = at the scale-down boundary (you would drop a level)
 * 100% = at the scale-up boundary   (you would advance a level)
 *
 * If the band has zero width (lower == upper) the bar reads 0%.
 */
export function computeScalingState(
  cumulativeUnits: number,
  activeRow: ScalingLogEntry | null,
): ScalingState {
  const currentUnitSize = activeRow?.unit_size_dollars ?? 0;
  const lower = Number(activeRow?.starting_units_threshold ?? 0);
  const upperRaw = activeRow?.ending_units_threshold;
  const upper =
    upperRaw == null
      ? lower + SCALE_BAND_UNITS
      : Number(upperRaw);

  const span = upper - lower;
  const progress =
    span <= 0
      ? 0
      : Math.max(0, Math.min(100, ((cumulativeUnits - lower) / span) * 100));

  let pendingNextSize: number | undefined;
  let pendingDirection: "up" | "down" | undefined;
  if (cumulativeUnits >= upper && currentUnitSize > 0) {
    pendingNextSize = scaleSize(currentUnitSize, "up");
    pendingDirection = "up";
  } else if (cumulativeUnits <= lower && currentUnitSize > 0) {
    pendingNextSize = scaleSize(currentUnitSize, "down");
    pendingDirection = "down";
  }

  return {
    currentUnitSize,
    bandStartUnits: lower,
    unitsAboveBand: cumulativeUnits - lower,
    scaleUpAt: upper,
    scaleDownAt: lower,
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

/* --------------------------------------------------------------- */
/* Total Unit Risk / Avg Bet Risk / Avg Daily Risk helpers          */
/* --------------------------------------------------------------- */

/**
 * Total Unit Risk for a single day = wager_total / unit_size_used.
 * Returns null when unit_size is missing/zero (we can't compute units
 * without knowing the day's unit size).
 */
export function totalUnitRiskForDay(
  wager_total: number | string,
  unit_size_used: number | string | null | undefined,
): number | null {
  const unitSize = Number(unit_size_used);
  const wager = Number(wager_total);
  if (!Number.isFinite(unitSize) || unitSize <= 0) return null;
  if (!Number.isFinite(wager) || wager <= 0) return null;
  return wager / unitSize;
}

/**
 * Avg Bet Risk for a single day = Total Unit Risk / bet_count.
 * Returns null when bet_count is zero or Total Unit Risk can't be
 * computed.
 */
export function avgBetRiskForDay(
  wager_total: number | string,
  unit_size_used: number | string | null | undefined,
  bet_count: number | string,
): number | null {
  const tur = totalUnitRiskForDay(wager_total, unit_size_used);
  if (tur == null) return null;
  const bets = Math.round(Number(bet_count));
  if (!Number.isFinite(bets) || bets <= 0) return null;
  return tur / bets;
}

/**
 * Avg Daily Risk (Lifetime) — mean of each day's **Total Unit Risk**
 * across valid days.
 *
 *   value = Σ TUR_day / num_valid_days
 *
 * Per product spec: "Avg Daily Risk must be based on the daily 'Total
 * Unit Risk' values, not the daily 'Avg Bet Risk' values."
 *
 * Returns null when no day in the set has a valid TUR.
 */
export function avgDailyRiskFromDays(
  days: Array<{
    wager_total: number | string;
    unit_size_used: number | string | null | undefined;
  }>,
): number | null {
  let sumTUR = 0;
  let validDays = 0;
  for (const d of days) {
    const tur = totalUnitRiskForDay(d.wager_total, d.unit_size_used);
    if (tur == null) continue;
    sumTUR += tur;
    validDays += 1;
  }
  if (validDays === 0) return null;
  return sumTUR / validDays;
}

/**
 * System-level Avg Daily Risk. journal_day_entries don't carry
 * unit_size_used; the unit size for each date comes from the system's
 * scaling log via activeScalingRow(). Same mean-of-daily-TUR shape as
 * the capper-level helper.
 */
export function avgDailyRiskFromJournal(
  journalDays: Array<{
    date: string;
    total_wager: number | string;
  }>,
  scaling: ScalingLogEntry[],
): number | null {
  let sumTUR = 0;
  let validDays = 0;
  for (const d of journalDays) {
    const row = activeScalingRow(scaling, d.date);
    const unitSize = row ? Number(row.unit_size_dollars) : 0;
    const tur = totalUnitRiskForDay(d.total_wager, unitSize);
    if (tur == null) continue;
    sumTUR += tur;
    validDays += 1;
  }
  if (validDays === 0) return null;
  return sumTUR / validDays;
}

/**
 * Avg Bet Risk (Lifetime) — mean of each day's **Avg Bet Risk** across
 * valid days.
 *
 *   value = Σ (TUR_day / bets_day) / num_valid_days
 *
 * Per product spec: "Avg Bet Risk summary values = based on daily Avg
 * Bet Risk figures." Pairs with avgDailyRiskFromDays so the two
 * lifetime metrics never share inputs.
 *
 * Returns null when no day has a valid Avg Bet Risk.
 */
export function avgBetRiskFromDays(
  days: Array<{
    wager_total: number | string;
    bet_count: number | string;
    unit_size_used: number | string | null | undefined;
  }>,
): number | null {
  let sumDailyAvg = 0;
  let validDays = 0;
  for (const d of days) {
    const abr = avgBetRiskForDay(d.wager_total, d.unit_size_used, d.bet_count);
    if (abr == null) continue;
    sumDailyAvg += abr;
    validDays += 1;
  }
  if (validDays === 0) return null;
  return sumDailyAvg / validDays;
}

/** System-level Avg Bet Risk; same mean-of-daily shape against journal rows. */
export function avgBetRiskFromJournal(
  journalDays: Array<{
    date: string;
    total_wager: number | string;
    total_bets: number | string;
  }>,
  scaling: ScalingLogEntry[],
): number | null {
  let sumDailyAvg = 0;
  let validDays = 0;
  for (const d of journalDays) {
    const row = activeScalingRow(scaling, d.date);
    const unitSize = row ? Number(row.unit_size_dollars) : 0;
    const abr = avgBetRiskForDay(d.total_wager, unitSize, d.total_bets);
    if (abr == null) continue;
    sumDailyAvg += abr;
    validDays += 1;
  }
  if (validDays === 0) return null;
  return sumDailyAvg / validDays;
}


/**
 * Bankroll convention: each unit represents 1/50th of the bankroll, so
 * the bankroll for a given unit size is always unit × 50. Exposed as a
 * constant so the UI form preview and the page-level "recalculate
 * bankroll" action stay in sync.
 */
export const BANKROLL_UNITS = 50;
export function bankrollForUnit(unitSize: number): number {
  return Math.round(Number(unitSize) * BANKROLL_UNITS);
}

export interface ScalingSequence {
  row: ScalingLogEntry;
  /** 1-based level number in the scaling sequence. */
  level: number;
  /** "up" / "down" vs the previous row; "neutral" for the first row. */
  direction: "up" | "down" | "neutral";
  /** Count of journal betting days in this row's active window. */
  sequenceOfDays: number;
  /** Sum of total_wager across the window. */
  totalRiskedAmount: number;
  /** total_wager / unit_size_dollars summed across the window. */
  totalRiskedUnits: number;
  /** Daily average $ wagered across the window (0 when no days). */
  avgRiskedAmount: number;
  /** Daily average units wagered across the window (0 when no days). */
  avgRiskedUnits: number;
  /** Derived bankroll: unit_size × 50. */
  bankroll: number;
  /** Inclusive start = row.effective_date. */
  windowStart: string;
  /** Exclusive end: next row's effective_date, or null for the live tail. */
  windowEndExclusive: string | null;
  /** True for the last row in the sequence (live running count). */
  isCurrent: boolean;
}

interface JournalLike {
  date: string;
  total_wager: number | string;
}

/**
 * Build the level / direction / sequence-of-days / risked rollups for
 * each scaling row. Pure derivation from the scaling history + journal
 * entries — no DB columns required.
 *
 *   - Level starts at 1 for the earliest row. Subsequent rows move +1
 *     when unit_size goes up, -1 when it goes down, unchanged when it's
 *     equal. (This mirrors the user's spec: level changes follow band
 *     crossings, and the unit_size change IS the result of the band
 *     crossing.)
 *
 *   - Sequence window = [row.effective_date, next.effective_date), or
 *     [row.effective_date, today] for the latest row. Counts include
 *     the effective_date itself; the level was set BEFORE betting that
 *     day, so the day's wagers belong to the new level.
 *
 *   - avg* uses sequenceOfDays as the denominator. 0 days → 0 avg.
 */
export function enrichScalingRows(
  scalingRows: ScalingLogEntry[],
  journalRows: JournalLike[],
  todayISO: string,
): ScalingSequence[] {
  const sorted = [...scalingRows].sort((a, b) =>
    a.effective_date.localeCompare(b.effective_date),
  );

  let level = 0;
  let prevUnit = 0;
  const out: ScalingSequence[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i];
    const unit = Number(row.unit_size_dollars);
    const next = sorted[i + 1];

    let direction: "up" | "down" | "neutral";
    if (i === 0) {
      level = 1;
      direction = "neutral";
    } else if (unit > prevUnit) {
      level += 1;
      direction = "up";
    } else if (unit < prevUnit) {
      level -= 1;
      direction = "down";
    } else {
      direction = "neutral";
    }
    prevUnit = unit;

    const windowStart = row.effective_date;
    const windowEndExclusive = next?.effective_date ?? null;
    const isCurrent = !next;

    let dayCount = 0;
    let totalWager = 0;
    for (const j of journalRows) {
      if (j.date < windowStart) continue;
      if (windowEndExclusive && j.date >= windowEndExclusive) continue;
      if (!windowEndExclusive && j.date > todayISO) continue;
      dayCount += 1;
      totalWager += Number(j.total_wager) || 0;
    }

    const totalRiskedAmount = totalWager;
    const totalRiskedUnits = unit > 0 ? totalRiskedAmount / unit : 0;
    const avgRiskedAmount = dayCount > 0 ? totalRiskedAmount / dayCount : 0;
    const avgRiskedUnits = dayCount > 0 ? totalRiskedUnits / dayCount : 0;

    out.push({
      row,
      level,
      direction,
      sequenceOfDays: dayCount,
      totalRiskedAmount,
      totalRiskedUnits,
      avgRiskedAmount,
      avgRiskedUnits,
      bankroll: bankrollForUnit(unit),
      windowStart,
      windowEndExclusive,
      isCurrent,
    });
  }

  return out;
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
  maxWinStreak: number;
  maxLossStreak: number;
  greenRoiCum: number;
  redRoiCum: number;
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
      maxWinStreak: 0,
      maxLossStreak: 0,
      greenRoiCum: 0,
      redRoiCum: 0,
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
    maxWinStreak: last.max_win_streak,
    maxLossStreak: last.max_loss_streak,
    greenRoiCum: Number(last.green_day_roi_cumulative ?? 0),
    redRoiCum: Number(last.red_day_roi_cumulative ?? 0),
  };
}
