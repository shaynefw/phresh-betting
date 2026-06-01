import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadShellContext } from "@/lib/active-system";
import type { JournalBaselineDay, JournalDayEntry } from "@/lib/types";
import {
  fmtMoney,
  fmtPct,
  fmtUnits,
  fmtWinLoss,
  pctClass,
  todayISO,
} from "@/lib/utils";
import {
  bucketDateLabel,
  bucketJournalForPeriod,
  resolvePeriod,
} from "@/lib/timeframe";
import ExportButton from "@/components/ExportButton";
import JournalBaselineForm from "@/components/JournalBaselineForm";
import TimeframeNav from "@/components/TimeframeNav";

export const dynamic = "force-dynamic";

/**
 * /journal — the Betting Journal table (period-bucketed).
 *
 * Five tabs: Day | Week | Month | Quarter | Year. The Day tab shows
 * every journal_day_entries row as its own row; the other tabs
 * aggregate by their respective bucket key (Mon-Sun weeks honoring the
 * 2026-05-25 transition; calendar month / quarter / year).
 *
 * Columns (matches the spec exactly — 11 columns):
 *   Date | Betting [period] | Bets | Wager | $ PNL | Units | ROI |
 *   Win Rate | Cum Units | Run ROI | Streak
 *
 * The "Betting [period]" column carries a GLOBAL chronological
 * sequence number — oldest bucket = 1, newest = N — so e.g. Week #13
 * counts from the start of the system's history regardless of which
 * filtered range is in view.
 *
 * Cum Units / Run ROI / Streak read from the LAST journal row inside
 * each bucket; those columns on journal_day_entries are already
 * running totals through that date, so taking the bucket's
 * latest-date row gives the true cumulative position at bucket end.
 */
export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<{
    date?: string;
    timeframe?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const sp = await searchParams;
  const ctx = await loadShellContext();
  if (!ctx) redirect("/sign-in");
  const sysId = ctx.activeSystemId;
  const supabase = createAdminClient();

  const [{ data }, { data: baseline }] = await Promise.all([
    supabase
      .from("journal_day_entries")
      .select("*")
      .eq("system_id", sysId)
      .order("date", { ascending: true }),
    supabase
      .from("journal_baseline_days")
      .select("*")
      .eq("system_id", sysId)
      .order("date"),
  ]);
  const allRows = (data ?? []) as JournalDayEntry[];
  const baselineRows = (baseline ?? []) as JournalBaselineDay[];

  const period = resolvePeriod({
    timeframe: sp.timeframe,
    date: sp.date,
    from: sp.from,
    to: sp.to,
    fallbackDate: allRows.at(-1)?.date ?? todayISO(),
  });

  // Bucket the full journal once. Each bucket carries the cumulative
  // values from its LAST journal row (already running totals).
  const buckets = bucketJournalForPeriod(allRows, period);
  // Display newest-first while preserving the global ASC seq number
  // that was assigned at bucket creation time (oldest bucket = 1).
  const displayBuckets = [...buckets]
    .map((b, i) => ({ b, seq: i + 1 }))
    .reverse();

  // Betting [period] column header — "Betting Days" for Day-tab,
  // "Betting Weeks" for Week-tab, etc. The Journal needs an
  // explicit per-tab label even though chartXAxisLabel collapses
  // the daily-resolution tabs to "Betting Days" — so we compute the
  // header ourselves here.
  const periodHeader = (() => {
    switch (period.kind) {
      case "day":
        return "Betting Days";
      case "week":
        return "Betting Weeks";
      case "month":
        return "Betting Months";
      case "quarter":
        return "Betting Quarters";
      case "year":
        return "Betting Years";
      default:
        return "Betting Days";
    }
  })();

  return (
    <div className="p-3 md:p-6 space-y-4 md:space-y-6" id="journal-root">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[10px] tracking-[0.4em] text-accent uppercase">
            Journal
          </div>
          <h1 className="text-2xl font-bold">Betting Journal</h1>
          <p className="text-ink-dim text-sm">
            Auto-synced from all active capper days. Read-only — edit a capper
            day to update a journal row.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <JournalBaselineForm systemId={sysId} initialRows={baselineRows} />
          <ExportButton targetId="journal-root" filename="journal.png" />
        </div>
      </header>

      <TimeframeNav
        kind={period.kind}
        anchorDate={period.anchorDate}
        from={period.kind === "custom" ? period.start : null}
        to={period.kind === "custom" ? period.end : null}
      />

      <div className="panel p-0">
        <div className="table-wrap">
          <table className="tbl font-mono">
            <thead>
              <tr>
                <th>Date</th>
                <th className="text-right">{periodHeader}</th>
                <th className="text-right">Bets</th>
                <th className="text-right">Wager</th>
                <th className="text-right">$ PNL</th>
                <th className="text-right">Units</th>
                <th className="text-right">ROI</th>
                <th className="text-right">Win Rate</th>
                <th className="text-right">Cum Units</th>
                <th className="text-right">Run ROI</th>
                <th className="text-right">Streak</th>
              </tr>
            </thead>
            <tbody>
              {displayBuckets.map(({ b, seq }) => (
                <tr key={b.key}>
                  <td>{bucketDateLabel(period, b)}</td>
                  <td className="text-right font-bold text-accent">{seq}</td>
                  <td className="text-right">{b.totalBets}</td>
                  <td className="text-right">{fmtMoney(b.totalWager)}</td>
                  <td className={`text-right ${pctClass(b.dailyAmountPnl)}`}>
                    {fmtMoney(b.dailyAmountPnl, { sign: true })}
                  </td>
                  <td className={`text-right ${pctClass(b.dailyUnitsPnl)}`}>
                    {fmtUnits(b.dailyUnitsPnl)}
                  </td>
                  <td className={`text-right ${pctClass(b.dailyRoiPercent)}`}>
                    {fmtPct(b.dailyRoiPercent)}
                  </td>
                  <td className={`text-right ${pctClass(b.wins - b.losses)}`}>
                    {fmtWinLoss(b.wins, b.losses)}
                  </td>
                  <td
                    className={`text-right ${pctClass(b.cumulativeUnitsPnl)}`}
                  >
                    {fmtUnits(b.cumulativeUnitsPnl)}
                  </td>
                  <td
                    className={`text-right ${pctClass(b.runningRoiPercent)}`}
                  >
                    {fmtPct(b.runningRoiPercent)}
                  </td>
                  <td
                    className={`text-right ${
                      b.currentStreakType === "green"
                        ? "text-good"
                        : b.currentStreakType === "red"
                          ? "text-bad"
                          : "text-ink-dim"
                    }`}
                  >
                    {b.currentStreakType === "neutral_hold"
                      ? "—"
                      : `${b.currentStreakType === "green" ? "+" : "-"}${b.currentStreakValue}`}
                  </td>
                </tr>
              ))}
              {displayBuckets.length === 0 && (
                <tr>
                  <td colSpan={11} className="text-center text-ink-dim py-6">
                    No journal entries yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
