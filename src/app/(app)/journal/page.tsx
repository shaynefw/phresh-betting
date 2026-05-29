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
  bucketJournalForPeriod,
  bucketDateLabel,
  chartXAxisLabel,
  resolvePeriod,
} from "@/lib/timeframe";
import ExportButton from "@/components/ExportButton";
import JournalBaselineForm from "@/components/JournalBaselineForm";
import TimeframeNav from "@/components/TimeframeNav";

export const dynamic = "force-dynamic";

/**
 * /journal — the Betting Journal table.
 *
 * Timeframe-aware: Day shows every journal_day_entries row; Week /
 * Month / Quarter / Year aggregate rows into period buckets and display
 * one row per bucket (totals summed within bucket, cumulative columns
 * read from the LAST journal row in each bucket). The new
 * "Betting [Period]" column right after Date auto-numbers buckets
 * chronologically starting at 1 for the oldest, so Week #13 etc. is
 * always the count from the start of the system's history.
 *
 * The from/to filter that used to live above the table has been
 * folded into the TimeframeNav (which is the dashboard's same
 * segmented control). Switching tabs replaces from/to filtering.
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

  // Always fetch the FULL journal so the Betting [Period] sequence
  // numbers are global (oldest = 1, newest = N) rather than relative
  // to a filtered window.
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
  // that was assigned at bucket creation time.
  const displayBuckets = [...buckets]
    .map((b, i) => ({ b, seq: i + 1 }))
    .reverse();

  const periodColumnTitle = chartXAxisLabel(period);

  return (
    <div className="p-3 md:p-6 space-y-4 md:space-y-6" id="journal-root">
      <header className="flex items-end justify-between gap-3">
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
                <th className="text-right">{periodColumnTitle}</th>
                <th className="text-right">Bets</th>
                <th className="text-right">Wager</th>
                <th className="text-right">Daily $ PnL</th>
                <th className="text-right">Daily Units</th>
                <th className="text-right">Daily ROI</th>
                <th className="text-right">Win Rate</th>
                <th className="text-right">Cum $</th>
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
                  <td
                    className={`text-right ${pctClass(b.wins - b.losses)}`}
                  >
                    {fmtWinLoss(b.wins, b.losses)}
                  </td>
                  <td
                    className={`text-right ${pctClass(b.cumulativeAmountPnl)}`}
                  >
                    {fmtMoney(b.cumulativeAmountPnl, { sign: true })}
                  </td>
                  <td
                    className={`text-right ${pctClass(b.cumulativeUnitsPnl)}`}
                  >
                    {fmtUnits(b.cumulativeUnitsPnl)}
                  </td>
                  <td className={`text-right ${pctClass(b.runningRoiPercent)}`}>
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
                  <td colSpan={12} className="text-center text-ink-dim py-6">
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
