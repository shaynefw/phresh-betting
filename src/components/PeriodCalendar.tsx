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
  type TimeframeKind,
} from "@/lib/timeframe";
import { fmtMoney, fmtUnits, pctClass } from "@/lib/utils";

/**
 * Period-aware PnL calendar.
 *
 *   Week    → 7-cell row for the days of the focus week
 *   Month   → 7-column grid for the days of the focus month
 *   Quarter → list of weeks inside the focus quarter
 *   Year    → 4-column grid for the months of the focus year
 *
 * Each cell tone-codes by the period's net units (positive = green
 * border + tint, negative = red, zero or no data = neutral). The
 * primary number is the period's net units; the smaller number is
 * the period's net $ PnL; the trailing row reads the W-L record.
 *
 * Navigation is LOCAL: the calendar owns its own anchor state, so
 * the prev / next chevrons page through history without touching the
 * dashboard's global ?date= URL param. When the parent rerenders
 * with a new tab (kind changes) or a new initial anchor (because the
 * user changed the global date), the local anchor resets.
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
  // LOCAL anchor state — initialized from the global anchor but never
  // pushed back to the URL. Reset whenever the parent passes a new
  // global anchor (e.g. tab switch).
  const [anchor, setAnchor] = useState(period.anchorDate);
  useEffect(() => {
    setAnchor(period.anchorDate);
  }, [period.anchorDate, period.kind]);

  // Resolve the displayed period bounds from the local anchor so prev/
  // next nav can paginate without touching props.
  const { start, end, headerLabel } = useMemo(
    () => resolveLocalBounds(period.kind, anchor),
    [period.kind, anchor],
  );

  const dayMap = useMemo(() => {
    const m = new Map<string, JournalDayEntry>();
    for (const r of rows) m.set(r.date, r);
    return m;
  }, [rows]);

  function nav(direction: -1 | 1) {
    setAnchor((a) => stepAnchor(period.kind, a, direction));
  }

  return (
    <div className="panel p-4 md:p-5">
      <div className="flex items-center justify-between mb-4">
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

      {period.kind === "week" && start && end && (
        <WeekDayGrid start={start} end={end} dayMap={dayMap} />
      )}
      {period.kind === "month" && start && end && (
        <MonthDayGrid start={start} dayMap={dayMap} />
      )}
      {period.kind === "quarter" && start && end && (
        <QuarterWeekGrid start={start} end={end} dayMap={dayMap} />
      )}
      {period.kind === "year" && start && (
        <YearGrid year={Number(start.slice(0, 4))} dayMap={dayMap} />
      )}
    </div>
  );
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
  // Walk start → end inclusively (≤7 days for full weeks, fewer for
  // the May-24 transitional bucket). Use the local day-of-week labels
  // for whichever day each cell actually falls on.
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
            className={`relative rounded-md border p-2 md:p-2.5 min-h-[80px] md:min-h-[96px] transition flex flex-col ${cellTone(units, hasData)}`}
          >
            <div className="flex items-baseline justify-between">
              <div className="text-[10px] text-ink-dim tracking-widest uppercase">
                {dow}
              </div>
              <div className="text-xs md:text-sm font-medium text-ink">
                {dayN}
              </div>
            </div>
            {hasData ? (
              <div className="mt-auto">
                <div
                  className={`text-sm md:text-base font-mono font-bold leading-tight ${pctClass(units)}`}
                >
                  {fmtUnits(units)}
                </div>
                <div
                  className={`text-[10px] md:text-[11px] font-mono leading-tight ${pctClass(amt)}`}
                >
                  {fmtMoney(amt, { sign: true })}
                </div>
                <div className="text-[9px] md:text-[10px] text-ink-dim font-mono leading-tight mt-0.5">
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
              className={`relative rounded-md border p-1.5 md:p-2 min-h-[58px] md:min-h-[68px] transition flex flex-col ${cellTone(units, hasData)}`}
            >
              <div className="text-[10px] md:text-xs font-medium text-ink">
                {dayN}
              </div>
              {hasData ? (
                <div className="mt-auto">
                  <div
                    className={`text-[11px] md:text-sm font-mono font-bold leading-tight ${pctClass(units)}`}
                  >
                    {fmtUnits(units)}
                  </div>
                  <div
                    className={`text-[9px] md:text-[10px] font-mono leading-tight ${pctClass(amt)}`}
                  >
                    {fmtMoney(amt, { sign: true })}
                  </div>
                  <div className="text-[8px] md:text-[9px] text-ink-dim font-mono leading-tight mt-0.5">
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
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5 md:gap-2">
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
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5 md:gap-2">
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
