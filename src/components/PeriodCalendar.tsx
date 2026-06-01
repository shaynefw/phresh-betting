"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { JournalDayEntry } from "@/lib/types";
import {
  addDays,
  addMonths,
  isoDate,
  journalWeekBucketKey,
  journalWeekBucketEnd,
  type TimeframeKind,
} from "@/lib/timeframe";
import { fmtMoney, fmtUnits, pctClass } from "@/lib/utils";

/**
 * Period subset PeriodCalendar receives from its server-component
 * parents. The full Period type carries a `bucketKey: (date) => string`
 * function which React's flight serializer rejects when crossing the
 * server → client boundary, so we accept only the primitive fields the
 * calendar actually reads.
 */
interface SerializablePeriod {
  kind: TimeframeKind;
  anchorDate: string;
  label: string;
  start: string | null;
  end: string | null;
}

/**
 * Period-aware performance calendar.
 *
 *   Day-tab  → 7-column month grid; each cell is one day
 *   Week-tab → 13-cell grid for the focus quarter; each cell is one week
 *   Year-tab → 4-col × 3-row month grid; each cell is one month
 *
 * Each cell carries: a primary label (day number / week range / month
 * name), the period's net units (large), the period's net $ PnL (small),
 * and the W-L record (small). Color tone follows the existing app
 * rules — green for positive units, red for negative, neutral for zero
 * or no data — with a soft tinted border so the calendar reads at a
 * glance without overwhelming the rest of the dashboard.
 *
 * The header shows the parent period's name + prev/next URL links
 * that step the `date` URL param backward/forward by one parent unit
 * (one month / one quarter / one year).
 */

interface Props {
  period: SerializablePeriod;
  rows: JournalDayEntry[];
}

function buildHref(
  pathname: string,
  current: URLSearchParams,
  newDate: string,
): string {
  const next = new URLSearchParams(current);
  next.set("date", newDate);
  return `${pathname}?${next.toString()}`;
}

function neighborAnchor(period: SerializablePeriod, direction: -1 | 1): string {
  if (period.kind === "year") {
    const y = Number(period.anchorDate.slice(0, 4));
    return `${y + direction}-${period.anchorDate.slice(5)}`;
  }
  if (period.kind === "week" || period.kind === "quarter") {
    return addMonths(period.anchorDate, direction * 3);
  }
  // Day / Month tabs both navigate by month.
  return addMonths(period.anchorDate, direction);
}

export default function PeriodCalendar({ period, rows }: Props) {
  const pathname = usePathname() ?? "/dashboard";
  const sp = useSearchParams();
  const currentParams = new URLSearchParams(sp?.toString() ?? "");

  const dayMap = useMemo(() => {
    const m = new Map<string, JournalDayEntry>();
    for (const r of rows) m.set(r.date, r);
    return m;
  }, [rows]);

  const prevHref = buildHref(pathname, currentParams, neighborAnchor(period, -1));
  const nextHref = buildHref(pathname, currentParams, neighborAnchor(period, 1));

  return (
    <div className="panel p-4 md:p-5">
      <div className="flex items-center justify-between mb-4">
        <Link
          href={prevHref}
          prefetch={false}
          className="p-1.5 rounded-md hover:bg-bg-card text-ink-dim hover:text-ink transition"
          aria-label="Previous period"
        >
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <div className="text-center">
          <div className="text-[10px] tracking-[0.3em] text-accent uppercase">
            {period.kind === "year"
              ? "Yearly Performance"
              : period.kind === "week"
                ? "Quarterly Performance"
                : "Monthly Performance"}
          </div>
          <div className="text-base md:text-lg font-bold">{period.label}</div>
        </div>
        <Link
          href={nextHref}
          prefetch={false}
          className="p-1.5 rounded-md hover:bg-bg-card text-ink-dim hover:text-ink transition"
          aria-label="Next period"
        >
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>

      {period.kind === "year" ? (
        <YearGrid period={period} dayMap={dayMap} />
      ) : period.kind === "week" ? (
        <QuarterWeekGrid period={period} dayMap={dayMap} />
      ) : (
        <MonthDayGrid period={period} dayMap={dayMap} />
      )}
    </div>
  );
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
/* Day-tab: month day grid                                         */
/* --------------------------------------------------------------- */

function MonthDayGrid({
  period,
  dayMap,
}: {
  period: SerializablePeriod;
  dayMap: Map<string, JournalDayEntry>;
}) {
  // Build a 6-row × 7-col grid covering the full month, padded with
  // leading/trailing blanks so the calendar always lines up under the
  // S M T W T F S header row.
  if (!period.start || !period.end) return null;
  const startDate = new Date(period.start + "T00:00:00Z");
  const monthFirst = new Date(
    Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1),
  );
  const monthLast = new Date(
    Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, 0),
  );
  const firstDow = monthFirst.getUTCDay(); // 0=Sun
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
              className={`relative rounded-md border p-1.5 md:p-2 min-h-[58px] md:min-h-[68px] transition flex flex-col ${cellTone(
                units,
                hasData,
              )}`}
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
/* Week-tab: weeks within a quarter                                */
/* --------------------------------------------------------------- */

function QuarterWeekGrid({
  period,
  dayMap,
}: {
  period: SerializablePeriod;
  dayMap: Map<string, JournalDayEntry>;
}) {
  if (!period.start || !period.end) return null;
  // Build week buckets covering [period.start, period.end]. A standard
  // quarter is ~13 weeks; we walk by 7 days starting at the bucket's
  // own start so partial first/last weeks of the quarter render correctly.
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
  let cur = period.start;
  while (cur <= period.end) {
    const key = journalWeekBucketKey(cur);
    const bucketEnd = journalWeekBucketEnd(cur);
    // Clamp the displayed bucket end to the quarter's end so the cell
    // labels don't bleed into the next quarter.
    const clampedEnd = bucketEnd > period.end ? period.end : bucketEnd;
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

function weekRangeLabel(start: string, end: string): string {
  const a = new Date(start + "T00:00:00Z");
  const b = new Date(end + "T00:00:00Z");
  const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (a.getUTCMonth() === b.getUTCMonth()) {
    return `${M[a.getUTCMonth()]} ${a.getUTCDate()}–${b.getUTCDate()}`;
  }
  return `${M[a.getUTCMonth()]} ${a.getUTCDate()} – ${M[b.getUTCMonth()]} ${b.getUTCDate()}`;
}

/* --------------------------------------------------------------- */
/* Year-tab: months within a year                                  */
/* --------------------------------------------------------------- */

function YearGrid({
  period,
  dayMap,
}: {
  period: SerializablePeriod;
  dayMap: Map<string, JournalDayEntry>;
}) {
  if (!period.start) return null;
  const year = Number(period.start.slice(0, 4));
  const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  // Aggregate journal rows into 12 month buckets.
  type MonthCell = {
    month: number;
    units: number;
    amount: number;
    wins: number;
    losses: number;
    days: number;
  };
  const months: MonthCell[] = M.map((_, m) => ({
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
                {M[c.month]}
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
