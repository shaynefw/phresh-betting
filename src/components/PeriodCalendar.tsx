"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { JournalDayEntry } from "@/lib/types";
import {
  addDays,
  addMonths,
  isoDate,
  journalWeekBucketKey,
  journalWeekBucketEnd,
  monthBoundsOf,
  quarterBoundsOf,
  quarterKeyOf,
  type TimeframeKind,
} from "@/lib/timeframe";
import { fmtMoney, fmtUnits, pctClass } from "@/lib/utils";

/**
 * Period-aware performance calendar — one unified design across every
 * timeframe (Week / Month / Quarter / Year). Structure mirrors the
 * reference design:
 *
 *   ┌ top summary strip (window-scoped stats + lifetime green prob) ┐
 *   ├ nav  <  Period Label  >                                        ┤
 *   ├ calendar grid ─────────────────────┬ right-side sub-period rail┤
 *   └────────────────────────────────────┴───────────────────────────┘
 *
 * Grid unit per timeframe:
 *   Week    → individual days of the focus week
 *   Month   → individual days of the focus month
 *   Quarter → individual weeks of the focus quarter
 *   Year    → individual months of the focus year
 *
 * Right-rail sub-period per timeframe:
 *   Week    → single compact week-total block
 *   Month   → weekly summary blocks
 *   Quarter → monthly summary blocks
 *   Year    → quarterly summary blocks
 *
 * Every top-strip metric and rail block is computed from the CURRENTLY
 * VISIBLE window only — except the Green [Timeframe] Probability, which
 * is a lifetime hit-rate across all completed periods of that type.
 *
 * Navigation is LOCAL: the calendar owns its own anchor state, so the
 * prev / next chevrons page through history without touching the
 * dashboard's global ?date= URL param.
 */

interface SerializablePeriod {
  kind: TimeframeKind;
  anchorDate: string;
  label: string;
  start: string | null;
  end: string | null;
}

interface Props {
  period: SerializablePeriod;
  rows: JournalDayEntry[];
}

export default function PeriodCalendar({ period, rows }: Props) {
  const [anchor, setAnchor] = useState(period.anchorDate);
  useEffect(() => {
    setAnchor(period.anchorDate);
  }, [period.anchorDate, period.kind]);

  const { start, end, headerLabel } = useMemo(
    () => resolveLocalBounds(period.kind, anchor),
    [period.kind, anchor],
  );

  const dayMap = useMemo(() => {
    const m = new Map<string, JournalDayEntry>();
    for (const r of rows) m.set(r.date, r);
    return m;
  }, [rows]);

  // Window-scoped rollup for the top strip. Recomputes as the user
  // navigates because it keys off the resolved [start, end].
  const stats = useMemo(
    () => (start && end ? windowStats(rows, start, end) : null),
    [rows, start, end],
  );

  // Lifetime hit rate for this timeframe type — independent of the
  // visible window (bucket every row by period kind, over all history).
  const greenProb = useMemo(
    () => lifetimeGreenProbability(rows, period.kind),
    [rows, period.kind],
  );

  function nav(direction: -1 | 1) {
    setAnchor((a) => stepAnchor(period.kind, a, direction));
  }

  return (
    <div className="panel p-4 md:p-5 space-y-4">
      {/* ---- Top summary strip ---- */}
      {stats && (
        <TopSummary
          kind={period.kind}
          stats={stats}
          greenProb={greenProb}
        />
      )}

      {/* ---- Nav ---- */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => nav(-1)}
          className="p-1.5 rounded-md hover:bg-bg-card text-ink-dim hover:text-ink transition"
          aria-label="Previous period"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="text-center">
          <div className="text-[10px] tracking-[0.3em] text-accent uppercase">
            {kindHeading(period.kind)}
          </div>
          <div className="text-base md:text-lg font-bold">{headerLabel}</div>
        </div>
        <button
          type="button"
          onClick={() => nav(1)}
          className="p-1.5 rounded-md hover:bg-bg-card text-ink-dim hover:text-ink transition"
          aria-label="Next period"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* ---- Grid + right rail ---- */}
      <div className="flex flex-col lg:flex-row gap-4">
        <div className="flex-1 min-w-0">
          {period.kind === "week" && start && end && (
            <WeekDayGrid start={start} end={end} dayMap={dayMap} />
          )}
          {period.kind === "month" && start && (
            <MonthDayGrid start={start} dayMap={dayMap} />
          )}
          {period.kind === "quarter" && start && end && (
            <QuarterWeekGrid start={start} end={end} dayMap={dayMap} />
          )}
          {period.kind === "year" && start && (
            <YearGrid year={Number(start.slice(0, 4))} dayMap={dayMap} />
          )}
        </div>

        {start && end && (
          <RightRail
            kind={period.kind}
            rows={rows}
            start={start}
            end={end}
          />
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- */
/* Window-scoped stats (top strip)                                 */
/* --------------------------------------------------------------- */

interface WindowStats {
  bettingDays: number;
  profitDays: number;
  lossDays: number;
  totalBets: number;
  netAmount: number;
  netUnits: number;
  avgPerDay: number;
}

/**
 * Roll up every journal row whose date falls in [start, end].
 *   - bettingDays = days present in the journal for this window
 *   - profitDays / lossDays = days with net $ above / below zero
 *     (break-even days count toward bettingDays but neither bucket)
 *   - avgPerDay = window $ P&L ÷ bettingDays (0 when no betting days)
 */
function windowStats(
  rows: JournalDayEntry[],
  start: string,
  end: string,
): WindowStats {
  let bettingDays = 0;
  let profitDays = 0;
  let lossDays = 0;
  let totalBets = 0;
  let netAmount = 0;
  let netUnits = 0;
  for (const r of rows) {
    if (r.date < start || r.date > end) continue;
    bettingDays += 1;
    const amt = Number(r.daily_amount_pnl) || 0;
    if (amt > 0) profitDays += 1;
    else if (amt < 0) lossDays += 1;
    totalBets += Number(r.total_bets) || 0;
    netAmount += amt;
    netUnits += Number(r.daily_units_pnl) || 0;
  }
  return {
    bettingDays,
    profitDays,
    lossDays,
    totalBets,
    netAmount,
    netUnits,
    avgPerDay: bettingDays === 0 ? 0 : netAmount / bettingDays,
  };
}

/**
 * Lifetime green-hit-rate for a timeframe type. Buckets every journal
 * row by the period kind, sums each bucket's net $, then returns
 * greenBuckets / (greenBuckets + redBuckets) × 100 — mirroring the
 * app's existing Green Day Probability convention (flat buckets are
 * excluded). Returns null when no graded period exists yet.
 */
function lifetimeGreenProbability(
  rows: JournalDayEntry[],
  kind: TimeframeKind,
): number | null {
  const keyOf = bucketKeyFor(kind);
  if (!keyOf) return null;
  const netByBucket = new Map<string, number>();
  for (const r of rows) {
    const k = keyOf(r.date);
    netByBucket.set(k, (netByBucket.get(k) ?? 0) + (Number(r.daily_amount_pnl) || 0));
  }
  let green = 0;
  let red = 0;
  for (const net of netByBucket.values()) {
    if (net > 0) green += 1;
    else if (net < 0) red += 1;
  }
  const graded = green + red;
  if (graded === 0) return null;
  return (green / graded) * 100;
}

/** Bucket key fn for the period kind used by lifetime probability. */
function bucketKeyFor(kind: TimeframeKind): ((d: string) => string) | null {
  switch (kind) {
    case "week":
      return journalWeekBucketKey;
    case "month":
      return (d) => d.slice(0, 7);
    case "quarter":
      return quarterKeyOf;
    case "year":
      return (d) => d.slice(0, 4);
    default:
      return null;
  }
}

function TopSummary({
  kind,
  stats,
  greenProb,
}: {
  kind: TimeframeKind;
  stats: WindowStats;
  greenProb: number | null;
}) {
  return (
    <div className="rounded-lg border border-border bg-bg-panel/40 p-3 md:p-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3 md:gap-4">
        <Stat label="Betting Days" value={String(stats.bettingDays)} />
        <Stat
          label="Profit Days"
          value={String(stats.profitDays)}
          tone={stats.profitDays > 0 ? 1 : 0}
        />
        <Stat
          label="Loss Days"
          value={String(stats.lossDays)}
          tone={stats.lossDays > 0 ? -1 : 0}
        />
        <Stat
          label="Avg Per Day"
          value={stats.bettingDays === 0 ? "—" : fmtMoney(stats.avgPerDay, { sign: true })}
          tone={stats.avgPerDay}
        />
        <Stat label="Total Bets" value={String(stats.totalBets)} />
        <Stat
          label={`${periodWord(kind)} P&L`}
          value={fmtMoney(stats.netAmount, { sign: true })}
          tone={stats.netAmount}
        />
        <Stat
          label={`Green ${periodWord(kind)} Prob.`}
          value={greenProb == null ? "—" : `${greenProb.toFixed(1)}%`}
          tone={greenProb == null ? 0 : greenProb >= 50 ? 1 : -1}
        />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: number;
}) {
  const cls =
    typeof tone === "number"
      ? tone > 0
        ? "text-good"
        : tone < 0
          ? "text-bad"
          : "text-ink"
      : "text-ink";
  return (
    <div>
      <div className="text-[9px] md:text-[10px] tracking-[0.15em] text-ink-dim uppercase mb-1">
        {label}
      </div>
      <div className={`font-mono font-bold text-base md:text-lg leading-none ${cls}`}>
        {value}
      </div>
    </div>
  );
}

/** "Week" / "Month" / "Quarter" / "Year" for the current kind. */
function periodWord(kind: TimeframeKind): string {
  switch (kind) {
    case "week":
      return "Week";
    case "month":
      return "Month";
    case "quarter":
      return "Quarter";
    case "year":
      return "Year";
    default:
      return "Period";
  }
}

/* --------------------------------------------------------------- */
/* Right-side sub-period rail                                      */
/* --------------------------------------------------------------- */

interface SubBlock {
  key: string;
  label: string;
  sublabel: string;
  units: number;
  amount: number;
  wins: number;
  losses: number;
  days: number;
}

function RightRail({
  kind,
  rows,
  start,
  end,
}: {
  kind: TimeframeKind;
  rows: JournalDayEntry[];
  start: string;
  end: string;
}) {
  const blocks = useMemo(
    () => bucketSubPeriods(rows, start, end, kind),
    [rows, start, end, kind],
  );
  if (blocks.length === 0) return null;

  return (
    <div className="lg:w-52 shrink-0">
      <div className="text-[10px] tracking-[0.2em] text-ink-dim uppercase mb-2">
        {railHeading(kind)}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-1 gap-2">
        {blocks.map((b) => {
          const hasData = b.days > 0;
          return (
            <div
              key={b.key}
              className={`rounded-md border p-2.5 ${cellTone(b.units, hasData)}`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <div className="text-[10px] tracking-widest text-ink-dim uppercase">
                  {b.label}
                </div>
                <div className="text-[9px] text-ink-dim font-mono shrink-0">
                  {b.days} day{b.days === 1 ? "" : "s"}
                </div>
              </div>
              {b.sublabel && (
                <div className="text-[9px] text-ink-dim leading-tight mt-0.5 truncate">
                  {b.sublabel}
                </div>
              )}
              {hasData ? (
                <>
                  <div
                    className={`text-base md:text-lg font-mono font-bold leading-tight mt-1 ${pctClass(b.units)}`}
                  >
                    {fmtUnits(b.units)}
                  </div>
                  <div
                    className={`text-[10px] font-mono leading-tight ${pctClass(b.amount)}`}
                  >
                    {fmtMoney(b.amount, { sign: true })}
                  </div>
                  <div className="text-[9px] text-ink-dim font-mono leading-tight">
                    {b.wins}-{b.losses}
                  </div>
                </>
              ) : (
                <div className="text-[10px] text-ink-dim italic mt-1">No data</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function railHeading(kind: TimeframeKind): string {
  switch (kind) {
    case "week":
      return "Week Total";
    case "month":
      return "Weekly Breakdown";
    case "quarter":
      return "Monthly Breakdown";
    case "year":
      return "Quarterly Breakdown";
    default:
      return "Breakdown";
  }
}

/**
 * Bucket the window's journal rows into the rail's sub-period unit.
 *   Week    → one block: the whole week's total
 *   Month   → weekly blocks (journal-week buckets)
 *   Quarter → monthly blocks
 *   Year    → quarterly blocks
 */
function bucketSubPeriods(
  rows: JournalDayEntry[],
  start: string,
  end: string,
  kind: TimeframeKind,
): SubBlock[] {
  const inWindow = rows.filter((r) => r.date >= start && r.date <= end);

  if (kind === "week") {
    // Single compact total block for the visible week.
    let units = 0;
    let amount = 0;
    let wins = 0;
    let losses = 0;
    let days = 0;
    for (const r of inWindow) {
      units += Number(r.daily_units_pnl) || 0;
      amount += Number(r.daily_amount_pnl) || 0;
      wins += Number(r.wins) || 0;
      losses += Number(r.losses) || 0;
      days += 1;
    }
    return [
      {
        key: "week-total",
        label: "Total",
        sublabel: weekRangeLabel(start, end),
        units,
        amount,
        wins,
        losses,
        days,
      },
    ];
  }

  if (kind === "month") {
    // Weekly blocks. Walk each week bucket that overlaps the month and
    // accumulate its in-month days.
    type Acc = SubBlock & { firstDate: string };
    const map = new Map<string, Acc>();
    for (const r of inWindow) {
      const k = journalWeekBucketKey(r.date);
      const bucketStart = k;
      const bucketEnd = journalWeekBucketEnd(r.date);
      let acc = map.get(k);
      if (!acc) {
        acc = {
          key: k,
          label: "",
          sublabel: weekRangeLabel(
            bucketStart < start ? start : bucketStart,
            bucketEnd > end ? end : bucketEnd,
          ),
          units: 0,
          amount: 0,
          wins: 0,
          losses: 0,
          days: 0,
          firstDate: r.date,
        };
        map.set(k, acc);
      }
      acc.units += Number(r.daily_units_pnl) || 0;
      acc.amount += Number(r.daily_amount_pnl) || 0;
      acc.wins += Number(r.wins) || 0;
      acc.losses += Number(r.losses) || 0;
      acc.days += 1;
      if (r.date < acc.firstDate) acc.firstDate = r.date;
    }
    const ordered = [...map.values()].sort((a, b) =>
      a.firstDate.localeCompare(b.firstDate),
    );
    ordered.forEach((b, i) => (b.label = `Week ${i + 1}`));
    return ordered;
  }

  if (kind === "quarter") {
    // Monthly blocks — one per calendar month in the quarter.
    const map = new Map<string, SubBlock>();
    for (const r of inWindow) {
      const k = r.date.slice(0, 7); // YYYY-MM
      let acc = map.get(k);
      if (!acc) {
        const m = Number(k.slice(5, 7)) - 1;
        acc = {
          key: k,
          label: MONTH_NAMES_SHORT[m] ?? k,
          sublabel: "",
          units: 0,
          amount: 0,
          wins: 0,
          losses: 0,
          days: 0,
        };
        map.set(k, acc);
      }
      acc.units += Number(r.daily_units_pnl) || 0;
      acc.amount += Number(r.daily_amount_pnl) || 0;
      acc.wins += Number(r.wins) || 0;
      acc.losses += Number(r.losses) || 0;
      acc.days += 1;
    }
    return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
  }

  if (kind === "year") {
    // Quarterly blocks — Q1..Q4.
    const map = new Map<string, SubBlock>();
    for (const r of inWindow) {
      const k = quarterKeyOf(r.date); // YYYY-Qn
      let acc = map.get(k);
      if (!acc) {
        acc = {
          key: k,
          label: k.slice(5), // "Qn"
          sublabel: "",
          units: 0,
          amount: 0,
          wins: 0,
          losses: 0,
          days: 0,
        };
        map.set(k, acc);
      }
      acc.units += Number(r.daily_units_pnl) || 0;
      acc.amount += Number(r.daily_amount_pnl) || 0;
      acc.wins += Number(r.wins) || 0;
      acc.losses += Number(r.losses) || 0;
      acc.days += 1;
    }
    return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
  }

  return [];
}

/* --------------------------------------------------------------- */
/* Resolve local bounds + navigation                               */
/* --------------------------------------------------------------- */

function resolveLocalBounds(
  kind: TimeframeKind,
  anchor: string,
): { start: string | null; end: string | null; headerLabel: string } {
  if (kind === "week") {
    const s = journalWeekBucketKey(anchor);
    const e = journalWeekBucketEnd(anchor);
    return { start: s, end: e, headerLabel: weekRangeLabel(s, e) };
  }
  if (kind === "month") {
    const { start, end, year, month } = monthBoundsOf(anchor);
    return { start, end, headerLabel: `${MONTH_NAMES[month]} ${year}` };
  }
  if (kind === "quarter") {
    const { start, end, year, quarter } = quarterBoundsOf(anchor);
    return { start, end, headerLabel: `Q${quarter} ${year}` };
  }
  if (kind === "year") {
    const year = Number(anchor.slice(0, 4));
    return {
      start: `${year}-01-01`,
      end: `${year}-12-31`,
      headerLabel: String(year),
    };
  }
  return { start: null, end: null, headerLabel: "" };
}

function stepAnchor(
  kind: TimeframeKind,
  anchor: string,
  direction: -1 | 1,
): string {
  switch (kind) {
    case "week":
      return addDays(anchor, direction * 7);
    case "month":
      return addMonths(anchor, direction);
    case "quarter":
      return addMonths(anchor, direction * 3);
    case "year": {
      const y = Number(anchor.slice(0, 4));
      return `${y + direction}-${anchor.slice(5)}`;
    }
    default:
      return anchor;
  }
}

function kindHeading(kind: TimeframeKind): string {
  switch (kind) {
    case "week":
      return "Weekly Performance";
    case "month":
      return "Monthly Performance";
    case "quarter":
      return "Quarterly Performance";
    case "year":
      return "Yearly Performance";
    default:
      return "Performance";
  }
}

/* --------------------------------------------------------------- */
/* Tone helpers                                                    */
/* --------------------------------------------------------------- */

function cellTone(units: number, hasData: boolean): string {
  if (!hasData) return "bg-bg-panel/30 border-border/40 text-ink-dim";
  if (units > 0)
    return "bg-good/[0.04] border-good/30 hover:border-good/50 shadow-[0_0_0_1px_rgba(34,197,94,0.08)]";
  if (units < 0)
    return "bg-bad/[0.04] border-bad/30 hover:border-bad/50 shadow-[0_0_0_1px_rgba(239,68,68,0.08)]";
  return "bg-bg-panel/40 border-border/60";
}

/* --------------------------------------------------------------- */
/* Week-tab: 7 days of the focus week                              */
/* --------------------------------------------------------------- */

function WeekDayGrid({
  start,
  end,
  dayMap,
}: {
  start: string;
  end: string;
  dayMap: Map<string, JournalDayEntry>;
}) {
  const cells: string[] = [];
  let cur = start;
  while (cur <= end) {
    cells.push(cur);
    cur = addDays(cur, 1);
  }
  const DOW = ["S", "M", "T", "W", "T", "F", "S"];
  return (
    <div className="grid grid-cols-7 gap-1 md:gap-1.5">
      {cells.map((date) => {
        const d = new Date(date + "T00:00:00Z");
        const row = dayMap.get(date);
        const units = Number(row?.daily_units_pnl ?? 0);
        const amt = Number(row?.daily_amount_pnl ?? 0);
        const hasData = !!row;
        const dayN = d.getUTCDate();
        const dow = DOW[d.getUTCDay()];
        return (
          <div
            key={date}
            className={`relative rounded-md border p-1 md:p-2.5 min-h-[76px] md:min-h-[96px] overflow-hidden transition flex flex-col ${cellTone(units, hasData)}`}
          >
            <div className="flex items-baseline justify-between gap-0.5">
              <div className="text-[9px] md:text-[10px] text-ink-dim tracking-wide uppercase">
                {dow}
              </div>
              <div className="text-[11px] md:text-sm font-medium text-ink">
                {dayN}
              </div>
            </div>
            {hasData ? (
              <div className="mt-auto min-w-0">
                <div
                  className={`text-[11px] md:text-base font-mono font-bold leading-tight tabular-nums truncate ${pctClass(units)}`}
                >
                  {fmtUnits(units)}
                </div>
                <div
                  className={`text-[9px] md:text-[11px] font-mono leading-tight tabular-nums truncate ${pctClass(amt)}`}
                >
                  {fmtMoney(amt, { sign: true })}
                </div>
                <div className="text-[9px] md:text-[10px] text-ink-dim font-mono leading-tight tabular-nums truncate mt-0.5">
                  {row.wins}-{row.losses}
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------------- */
/* Month-tab: 7-col day grid                                       */
/* --------------------------------------------------------------- */

function MonthDayGrid({
  start,
  dayMap,
}: {
  start: string;
  dayMap: Map<string, JournalDayEntry>;
}) {
  const startDate = new Date(start + "T00:00:00Z");
  const monthFirst = new Date(
    Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1),
  );
  const monthLast = new Date(
    Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, 0),
  );
  const firstDow = monthFirst.getUTCDay();
  const daysInMonth = monthLast.getUTCDate();

  const cells: Array<{ date: string | null }> = [];
  for (let i = 0; i < firstDow; i++) cells.push({ date: null });
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(
      Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), d),
    );
    cells.push({ date: isoDate(date) });
  }
  while (cells.length % 7 !== 0) cells.push({ date: null });

  return (
    <>
      <div className="grid grid-cols-7 gap-1 mb-1.5">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div
            key={i}
            className="text-center text-[10px] tracking-widest text-ink-dim uppercase"
          >
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1 md:gap-1.5">
        {cells.map((c, i) => {
          if (!c.date) return <div key={i} />;
          const row = dayMap.get(c.date);
          const units = Number(row?.daily_units_pnl ?? 0);
          const amt = Number(row?.daily_amount_pnl ?? 0);
          const hasData = !!row;
          const dayN = Number(c.date.slice(-2));
          return (
            <div
              key={c.date}
              className={`relative rounded-md border p-1 md:p-2 min-h-[56px] md:min-h-[68px] overflow-hidden transition flex flex-col ${cellTone(units, hasData)}`}
            >
              <div className="text-[10px] md:text-xs font-medium text-ink leading-none">
                {dayN}
              </div>
              {hasData ? (
                <div className="mt-auto min-w-0">
                  <div
                    className={`text-[10px] md:text-sm font-mono font-bold leading-tight tabular-nums truncate ${pctClass(units)}`}
                  >
                    {fmtUnits(units)}
                  </div>
                  <div
                    className={`text-[8px] md:text-[10px] font-mono leading-tight tabular-nums truncate ${pctClass(amt)}`}
                  >
                    {fmtMoney(amt, { sign: true })}
                  </div>
                  <div className="text-[8px] md:text-[9px] text-ink-dim font-mono leading-tight tabular-nums truncate mt-0.5">
                    {row.wins}-{row.losses}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </>
  );
}

/* --------------------------------------------------------------- */
/* Quarter-tab: weeks inside the focus quarter                     */
/* --------------------------------------------------------------- */

function QuarterWeekGrid({
  start,
  end,
  dayMap,
}: {
  start: string;
  end: string;
  dayMap: Map<string, JournalDayEntry>;
}) {
  type WeekCell = {
    key: string;
    start: string;
    end: string;
    units: number;
    amount: number;
    wins: number;
    losses: number;
    days: number;
  };
  const map = new Map<string, WeekCell>();
  let cur = start;
  while (cur <= end) {
    const key = journalWeekBucketKey(cur);
    const bucketEnd = journalWeekBucketEnd(cur);
    const clampedEnd = bucketEnd > end ? end : bucketEnd;
    if (!map.has(key)) {
      map.set(key, {
        key,
        start: cur < key ? key : cur,
        end: clampedEnd,
        units: 0,
        amount: 0,
        wins: 0,
        losses: 0,
        days: 0,
      });
    }
    const cell = map.get(key)!;
    const r = dayMap.get(cur);
    if (r) {
      cell.units += Number(r.daily_units_pnl) || 0;
      cell.amount += Number(r.daily_amount_pnl) || 0;
      cell.wins += Number(r.wins) || 0;
      cell.losses += Number(r.losses) || 0;
      cell.days += 1;
    }
    cur = addDays(cur, 1);
  }
  const cells = [...map.values()].sort((a, b) => a.start.localeCompare(b.start));

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 md:gap-2">
      {cells.map((c, i) => {
        const hasData = c.days > 0;
        return (
          <div
            key={c.key}
            className={`relative rounded-md border p-2 md:p-3 transition flex flex-col gap-1 ${cellTone(c.units, hasData)}`}
          >
            <div className="flex items-baseline justify-between">
              <div className="text-[10px] tracking-widest text-ink-dim uppercase">
                Week {i + 1}
              </div>
              <div className="text-[9px] text-ink-dim font-mono">
                {c.days} day{c.days === 1 ? "" : "s"}
              </div>
            </div>
            <div className="text-[10px] text-ink-dim leading-tight">
              {weekRangeLabel(c.start, c.end)}
            </div>
            <div
              className={`text-base md:text-lg font-mono font-bold leading-tight ${pctClass(c.units)}`}
            >
              {fmtUnits(c.units)}
            </div>
            <div
              className={`text-[11px] font-mono leading-tight ${pctClass(c.amount)}`}
            >
              {fmtMoney(c.amount, { sign: true })}
            </div>
            <div className="text-[10px] text-ink-dim font-mono">
              {c.wins}-{c.losses}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTH_NAMES_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function weekRangeLabel(start: string, end: string): string {
  const a = new Date(start + "T00:00:00Z");
  const b = new Date(end + "T00:00:00Z");
  if (a.getUTCMonth() === b.getUTCMonth()) {
    return `${MONTH_NAMES_SHORT[a.getUTCMonth()]} ${a.getUTCDate()}–${b.getUTCDate()}`;
  }
  return `${MONTH_NAMES_SHORT[a.getUTCMonth()]} ${a.getUTCDate()} – ${MONTH_NAMES_SHORT[b.getUTCMonth()]} ${b.getUTCDate()}`;
}

/* --------------------------------------------------------------- */
/* Year-tab: months inside the focus year                          */
/* --------------------------------------------------------------- */

function YearGrid({
  year,
  dayMap,
}: {
  year: number;
  dayMap: Map<string, JournalDayEntry>;
}) {
  type MonthCell = {
    month: number;
    units: number;
    amount: number;
    wins: number;
    losses: number;
    days: number;
  };
  const months: MonthCell[] = MONTH_NAMES_SHORT.map((_, m) => ({
    month: m,
    units: 0,
    amount: 0,
    wins: 0,
    losses: 0,
    days: 0,
  }));
  for (const [date, r] of dayMap.entries()) {
    if (date.slice(0, 4) !== String(year)) continue;
    const m = Number(date.slice(5, 7)) - 1;
    if (m < 0 || m > 11) continue;
    const cell = months[m];
    cell.units += Number(r.daily_units_pnl) || 0;
    cell.amount += Number(r.daily_amount_pnl) || 0;
    cell.wins += Number(r.wins) || 0;
    cell.losses += Number(r.losses) || 0;
    cell.days += 1;
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 md:gap-2">
      {months.map((c) => {
        const hasData = c.days > 0;
        return (
          <div
            key={c.month}
            className={`relative rounded-md border p-2 md:p-3 transition flex flex-col gap-1 ${cellTone(c.units, hasData)}`}
          >
            <div className="flex items-baseline justify-between">
              <div className="text-xs tracking-widest text-ink uppercase font-medium">
                {MONTH_NAMES_SHORT[c.month]}
              </div>
              <div className="text-[9px] text-ink-dim font-mono">
                {c.days} day{c.days === 1 ? "" : "s"}
              </div>
            </div>
            {hasData ? (
              <>
                <div
                  className={`text-base md:text-lg font-mono font-bold leading-tight ${pctClass(c.units)}`}
                >
                  {fmtUnits(c.units)}
                </div>
                <div
                  className={`text-[11px] font-mono leading-tight ${pctClass(c.amount)}`}
                >
                  {fmtMoney(c.amount, { sign: true })}
                </div>
                <div className="text-[10px] text-ink-dim font-mono">
                  {c.wins}-{c.losses}
                </div>
              </>
            ) : (
              <div className="text-[10px] text-ink-dim italic">No data</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
