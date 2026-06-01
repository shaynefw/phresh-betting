import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadShellContext } from "@/lib/active-system";
import type { JournalBaselineDay, JournalDayEntry } from "@/lib/types";
import { fmtMoney, fmtPct, fmtUnits, todayISO } from "@/lib/utils";
import { aggregateForPeriod, isInPeriod, resolvePeriod } from "@/lib/timeframe";
import ExportButton from "@/components/ExportButton";
import JournalBaselineForm from "@/components/JournalBaselineForm";
import PeriodCalendar from "@/components/PeriodCalendar";
import TimeframeNav from "@/components/TimeframeNav";

export const dynamic = "force-dynamic";

/**
 * /journal — the Betting Journal.
 *
 * Layout, after the redesign:
 *
 *   1. Header + Baseline form + Export.
 *   2. Period tabs (Day | Week | Year) driving which calendar grid
 *      shows below.
 *   3. Calendar:
 *        Day-tab  → 7-col month grid; each cell is one day
 *        Week-tab → 13-cell quarter grid; each cell is one week
 *        Year-tab → 4-col month grid; each cell is one month
 *   4. Period footer summary — Profit, ROI, Record, Days for the
 *      current parent period.
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

  // Period totals strip below the calendar.
  const periodRows = allRows.filter((r) => isInPeriod(r.date, period));
  const periodAgg = aggregateForPeriod(periodRows);

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

      <PeriodCalendar period={period} rows={allRows} />

      {/* Period totals — small footer summary so the eye can land on
          a single set of numbers for the displayed parent period. */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <PeriodStat
          label="Profit"
          value={fmtMoney(periodAgg.cumulativeAmount, { sign: true })}
          sub={`Units: ${fmtUnits(periodAgg.cumulativeUnits)}`}
          tone={periodAgg.cumulativeAmount}
        />
        <PeriodStat
          label="ROI"
          value={fmtPct(periodAgg.runningRoi)}
          sub={`Risked: ${fmtMoney(periodAgg.totalRisk)}`}
          tone={periodAgg.runningRoi}
        />
        <PeriodStat
          label="Record"
          value={`${periodAgg.wins} - ${periodAgg.losses}`}
          sub={`Win: ${periodAgg.winRate.toFixed(2)}%`}
        />
        <PeriodStat
          label="Days Tracked"
          value={String(periodAgg.totalDays)}
          sub={`${periodAgg.totalBets} bets`}
        />
      </section>
    </div>
  );
}

function PeriodStat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
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
    <div className="panel p-4 text-center">
      <div className="text-[10px] tracking-[0.3em] text-ink-dim uppercase mb-1.5">
        {label}
      </div>
      <div className={`text-xl md:text-2xl font-bold font-mono leading-none ${cls}`}>
        {value}
      </div>
      {sub && (
        <div className="text-[10px] text-ink-dim font-mono mt-1.5">{sub}</div>
      )}
    </div>
  );
}
