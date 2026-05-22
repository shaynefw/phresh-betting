/**
 * Timeframe / period abstraction for the multi-timeframe dashboard view.
 *
 * The dashboard supports six timeframe modes — Day, Week, Month, Year,
 * All, and Custom — all driven by URL search params so the entire view
 * is server-rendered with no client state.
 *
 *   ?timeframe=day&date=YYYY-MM-DD          ← single day
 *   ?timeframe=week&date=YYYY-MM-DD         ← Mon-Sun of that date's week
 *   ?timeframe=month&date=YYYY-MM-DD        ← calendar month
 *   ?timeframe=year&date=YYYY-MM-DD         ← calendar year
 *   ?timeframe=all                          ← every recorded day
 *   ?timeframe=custom&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Day and All are the "daily" modes — buckets equal calendar dates and
 * streak math is per-day. Week/Month/Year re-bucket the entire journal
 * history into the chosen unit and run the same streak rule across
 * those buckets. Custom bucks daily within the selected range.
 *
 * All date math uses UTC so the user's local timezone never shifts
 * which day a bet "belongs" to.
 */

import type { JournalDayEntry, StreakType } from "@/lib/types";
import { streakBreakdown as dayStreakBreakdown } from "@/lib/streaks";

export type TimeframeKind =
  | "day"
  | "week"
  | "month"
  | "year"
  | "all"
  | "custom";

/** Unit of the bucket the period uses for streak math + labels. */
export type BucketNoun = "day" | "week" | "month" | "year";

export interface Period {
  kind: TimeframeKind;
  /** Inclusive start (ISO YYYY-MM-DD), or null for "all". */
  start: string | null;
  /** Inclusive end (ISO YYYY-MM-DD), or null for "all". */
  end: string | null;
  /** Unit the streak / breakdown is measured in. */
  bucketNoun: BucketNoun;
  /** Long display label, e.g. "Week of May 18 — May 24, 2026". */
  label: string;
  /** Short label used in column headers / footers, e.g. "Week". */
  shortLabel: string;
  /** Returns the bucket key a given date belongs to. */
  bucketKey: (date: string) => string;
  /** Original date input (echoed back for URL building). */
  anchorDate: string;
}

/* --------------------------------------------------------------- */
/* Pure date helpers                                               */
/* --------------------------------------------------------------- */

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function asUTC(iso: string): Date {
  // Append the time so the parsed Date is UTC midnight, not local midnight.
  return new Date(iso + "T00:00:00Z");
}

export function addDays(iso: string, n: number): string {
  const d = asUTC(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

/** Monday-of-week (week starts Monday per spec). */
export function mondayOfISOWeek(iso: string): string {
  const d = asUTC(iso);
  const dow = d.getUTCDay(); // 0=Sun, 1=Mon ... 6=Sat
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diff);
  return isoDate(d);
}

export function sundayOfISOWeek(iso: string): string {
  return addDays(mondayOfISOWeek(iso), 6);
}

export function monthBoundsOf(iso: string): {
  start: string;
  end: string;
  year: number;
  month: number; // 0-based
} {
  const d = asUTC(iso);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1));
  const end = new Date(Date.UTC(y, m + 1, 0)); // last day of month
  return { start: isoDate(start), end: isoDate(end), year: y, month: m };
}

export function yearBoundsOf(iso: string): {
  start: string;
  end: string;
  year: number;
} {
  const d = asUTC(iso);
  const y = d.getUTCFullYear();
  return { start: `${y}-01-01`, end: `${y}-12-31`, year: y };
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const MONTH_NAMES_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "May 18, 2026" — compact-ish date label. */
export function formatDateMedium(iso: string): string {
  const d = asUTC(iso);
  return `${MONTH_NAMES_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/* --------------------------------------------------------------- */
/* Period resolution                                               */
/* --------------------------------------------------------------- */

const VALID_KINDS = new Set<TimeframeKind>([
  "day",
  "week",
  "month",
  "year",
  "all",
  "custom",
]);

function coerceKind(s: string | undefined): TimeframeKind {
  if (s && VALID_KINDS.has(s as TimeframeKind)) return s as TimeframeKind;
  return "day";
}

/**
 * Resolve URL search params (+ a fallback "latest tracked day") into a
 * concrete Period. The fallback date is used whenever `date` (or `from`
 * on custom) is missing — typically the dashboard passes
 * `journalRows.at(-1)?.date ?? todayISO()`.
 */
export function resolvePeriod(opts: {
  timeframe?: string;
  date?: string;
  from?: string;
  to?: string;
  fallbackDate: string;
}): Period {
  const kind = coerceKind(opts.timeframe);

  if (kind === "all") {
    return {
      kind: "all",
      start: null,
      end: null,
      bucketNoun: "day",
      label: "All-Time",
      shortLabel: "All-Time",
      bucketKey: (d) => d,
      anchorDate: opts.date ?? opts.fallbackDate,
    };
  }

  if (kind === "custom") {
    const from = opts.from ?? opts.date ?? opts.fallbackDate;
    const to = opts.to ?? from; // single-day custom if only `from`
    const start = from <= to ? from : to;
    const end = from <= to ? to : from;
    return {
      kind: "custom",
      start,
      end,
      bucketNoun: "day",
      label:
        start === end
          ? formatDateMedium(start)
          : `${formatDateMedium(start)} — ${formatDateMedium(end)}`,
      shortLabel: start === end ? "Day" : "Range",
      bucketKey: (d) => d,
      anchorDate: end,
    };
  }

  // Day / Week / Month / Year all key off a single anchor date.
  const focus = opts.date ?? opts.fallbackDate;

  if (kind === "day") {
    return {
      kind: "day",
      start: focus,
      end: focus,
      bucketNoun: "day",
      label: formatDateMedium(focus),
      shortLabel: "Day",
      bucketKey: (d) => d,
      anchorDate: focus,
    };
  }

  if (kind === "week") {
    const mon = mondayOfISOWeek(focus);
    const sun = sundayOfISOWeek(focus);
    return {
      kind: "week",
      start: mon,
      end: sun,
      bucketNoun: "week",
      label: `Week of ${formatDateMedium(mon)} — ${formatDateMedium(sun)}`,
      shortLabel: "Week",
      bucketKey: (d) => mondayOfISOWeek(d),
      anchorDate: focus,
    };
  }

  if (kind === "month") {
    const { start, end, year, month } = monthBoundsOf(focus);
    return {
      kind: "month",
      start,
      end,
      bucketNoun: "month",
      label: `${MONTH_NAMES[month]} ${year}`,
      shortLabel: "Month",
      bucketKey: (d) => d.slice(0, 7), // YYYY-MM
      anchorDate: focus,
    };
  }

  // year
  const { start, end, year } = yearBoundsOf(focus);
  return {
    kind: "year",
    start,
    end,
    bucketNoun: "year",
    label: String(year),
    shortLabel: "Year",
    bucketKey: (d) => d.slice(0, 4), // YYYY
    anchorDate: focus,
  };
}

/* --------------------------------------------------------------- */
/* Filtering + aggregation                                         */
/* --------------------------------------------------------------- */

export function isInPeriod(date: string, p: Period): boolean {
  if (p.start && date < p.start) return false;
  if (p.end && date > p.end) return false;
  return true;
}

/**
 * Aggregate a set of journal rows over a period. Mirrors the shape of
 * `summarizeJournal()` so the existing PerformanceSummary / DailySummary
 * panels can consume either return value. Unlike `summarizeJournal()`,
 * which reads cumulative state off the last row, this version computes
 * everything from scratch — necessary when the period is a subset.
 */
export function aggregateForPeriod(rows: JournalDayEntry[]): {
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
  wins: number;
  losses: number;
  winRate: number;
} {
  if (rows.length === 0) {
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
      wins: 0,
      losses: 0,
      winRate: 0,
    };
  }
  let sumUnits = 0;
  let sumAmount = 0;
  let sumWager = 0;
  let sumBets = 0;
  let wins = 0;
  let losses = 0;
  let greenDays = 0;
  let redDays = 0;
  let greenRoiCum = 0;
  let redRoiCum = 0;
  for (const r of rows) {
    sumUnits += Number(r.daily_units_pnl);
    sumAmount += Number(r.daily_amount_pnl);
    sumWager += Number(r.total_wager);
    sumBets += Number(r.total_bets);
    wins += Number(r.wins);
    losses += Number(r.losses);
    const roi = Number(r.daily_roi_percent);
    if (roi > 0) {
      greenDays++;
      greenRoiCum += roi;
    } else if (roi < 0) {
      redDays++;
      redRoiCum += roi;
    }
  }
  const totalGraded = greenDays + redDays;
  return {
    cumulativeUnits: sumUnits,
    cumulativeAmount: sumAmount,
    totalDays: rows.length,
    totalBets: sumBets,
    totalRisk: sumWager,
    runningRoi: sumWager === 0 ? 0 : (sumAmount / sumWager) * 100,
    greenDays,
    redDays,
    greenAvgRoi: greenDays === 0 ? 0 : greenRoiCum / greenDays,
    redAvgRoi: redDays === 0 ? 0 : redRoiCum / redDays,
    greenProbability: totalGraded === 0 ? 0 : (greenDays / totalGraded) * 100,
    wins,
    losses,
    winRate: wins + losses === 0 ? 0 : (wins / (wins + losses)) * 100,
  };
}

/* --------------------------------------------------------------- */
/* Bucket aggregates                                               */
/* --------------------------------------------------------------- */

export interface BucketAgg {
  /** e.g. "2026-W19" for weeks, "2026-05" for months, "2026" for years. */
  key: string;
  /** First date in the bucket (chronological sort key). */
  firstDate: string;
  totalWager: number;
  totalAmount: number;
  totalUnits: number;
  wins: number;
  losses: number;
  /** Bucket-level daily-roi-style ROI (sum_amount / sum_wager × 100). */
  daily_roi_percent: number;
  /** Sortable date string — first date in the bucket, ISO. */
  date: string;
}

/**
 * Group a set of journal rows into buckets keyed by `period.bucketKey`.
 * Each bucket aggregates wager / pnl / units / wins / losses, and the
 * synthesized `daily_roi_percent` lets us reuse the existing daily
 * streak helpers (which only read `date` + `daily_roi_percent`).
 */
export function bucketRows(
  rows: JournalDayEntry[],
  bucketKey: (d: string) => string,
): BucketAgg[] {
  const map = new Map<string, BucketAgg>();
  for (const r of rows) {
    const k = bucketKey(r.date);
    let b = map.get(k);
    if (!b) {
      b = {
        key: k,
        firstDate: r.date,
        totalWager: 0,
        totalAmount: 0,
        totalUnits: 0,
        wins: 0,
        losses: 0,
        daily_roi_percent: 0,
        date: r.date,
      };
      map.set(k, b);
    }
    b.totalWager += Number(r.total_wager);
    b.totalAmount += Number(r.daily_amount_pnl);
    b.totalUnits += Number(r.daily_units_pnl);
    b.wins += Number(r.wins);
    b.losses += Number(r.losses);
    if (r.date < b.firstDate) {
      b.firstDate = r.date;
      b.date = r.date;
    }
  }
  // Finalize ROI now that sums are stable, then sort chronologically.
  const list = [...map.values()].map((b) => ({
    ...b,
    daily_roi_percent:
      b.totalWager === 0 ? 0 : (b.totalAmount / b.totalWager) * 100,
  }));
  list.sort((a, b) => a.firstDate.localeCompare(b.firstDate));
  return list;
}

/**
 * Walk buckets chronologically and return the streak as-of the LAST
 * bucket in the input. ROI = 0 holds the previous streak (matches the
 * recompute_capper / recompute_journal SQL rule).
 */
export function computeStreakAcrossBuckets(buckets: BucketAgg[]): {
  type: StreakType;
  value: number;
  maxWinStreak: number;
  maxLossStreak: number;
} {
  let type: StreakType = "neutral_hold";
  let value = 0;
  let maxWin = 0;
  let maxLoss = 0;
  for (const b of buckets) {
    if (b.daily_roi_percent > 0) {
      type = type === "green" ? "green" : "green";
      value = type === "green" && value > 0 ? value + 1 : 1;
      type = "green";
      if (value > maxWin) maxWin = value;
    } else if (b.daily_roi_percent < 0) {
      value = type === "red" && value > 0 ? value + 1 : 1;
      type = "red";
      if (value > maxLoss) maxLoss = value;
    }
    // == 0: hold (unchanged)
  }
  return { type, value, maxWinStreak: maxWin, maxLossStreak: maxLoss };
}

/**
 * Bucket-level breakdown — counts of how many times each (type,
 * length) streak run occurred. Re-uses the daily streakBreakdown
 * helper by handing it the bucket aggregates (which already carry a
 * `date` + `daily_roi_percent` shape).
 */
export function bucketStreakBreakdown(buckets: BucketAgg[]) {
  return dayStreakBreakdown(buckets);
}

/* --------------------------------------------------------------- */
/* Wording helpers                                                 */
/* --------------------------------------------------------------- */

/** "Daily Summary" / "Weekly Summary" / etc. */
export function summaryTitle(p: Period): string {
  switch (p.kind) {
    case "day":
      return `Daily Summary — ${p.label}`;
    case "week":
      return `Weekly Summary — ${p.label}`;
    case "month":
      return `Monthly Summary — ${p.label}`;
    case "year":
      return `Yearly Summary — ${p.label}`;
    case "all":
      return "All-Time Summary";
    case "custom":
      return `Range Summary — ${p.label}`;
  }
}

/** "On the Day" / "On the Week" / etc. — bottom-strip + per-capper header. */
export function periodFooterLabel(p: Period): string {
  switch (p.kind) {
    case "day":
      return "On the Day";
    case "week":
      return "On the Week";
    case "month":
      return "On the Month";
    case "year":
      return "On the Year";
    case "all":
      return "All-Time";
    case "custom":
      return p.start === p.end ? "On the Day" : "On Range";
  }
}

/** Column header for the per-capper period units. */
export function periodColumnHeader(p: Period): string {
  switch (p.kind) {
    case "day":
      return "ON THE DAY";
    case "week":
      return "ON THE WEEK";
    case "month":
      return "ON THE MONTH";
    case "year":
      return "ON THE YEAR";
    case "all":
      return "ALL-TIME";
    case "custom":
      return p.start === p.end ? "ON THE DAY" : "ON RANGE";
  }
}
