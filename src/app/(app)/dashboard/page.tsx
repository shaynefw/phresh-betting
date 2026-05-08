import { redirect } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadShellContext } from "@/lib/active-system";
import {
  activeScalingRow,
  computeScalingState,
  summarizeJournal,
} from "@/lib/calc";
import {
  fmtMoney,
  fmtPct,
  fmtUnits,
  pctClass,
  todayISO,
} from "@/lib/utils";
import type {
  Capper,
  CapperBaseline,
  CapperDayEntry,
  JournalDayEntry,
  ScalingLogEntry,
  System,
  SystemBaseline,
} from "@/lib/types";
import {
  aggregateBaselines,
  combineWithJournal,
  effectiveGreenCum,
  effectiveRedCum,
} from "@/lib/baseline";
import { mergeBreakdowns, streakBreakdown } from "@/lib/streaks";
import ExportButton from "@/components/ExportButton";
import CumulativeUnitsChart from "@/components/charts/CumulativeUnitsChart";
import PerformanceSummary from "@/components/PerformanceSummary";
import StreakBreakdown from "@/components/StreakBreakdown";
import {
  TrendingUp, TrendingDown, Flame, Snowflake, Activity, Target,
} from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await loadShellContext();
  if (!ctx) redirect("/sign-in");
  const supabase = createAdminClient();
  const sysId = ctx.activeSystemId;
  if (!sysId) redirect("/systems?first=1");

  const [
    { data: sys },
    { data: journal },
    { data: scaling },
    { data: cappers },
    { data: dayRows },
    { data: baselineRows },
    { data: systemBaselineRow },
  ] = await Promise.all([
    supabase.from("systems").select("*").eq("id", sysId).single(),
    supabase.from("journal_day_entries").select("*").eq("system_id", sysId).order("date"),
    supabase.from("scaling_log_entries").select("*").eq("system_id", sysId).order("effective_date"),
    supabase.from("cappers").select("*").eq("system_id", sysId).order("sort_order").order("created_at"),
    supabase.from("capper_day_entries").select("*").eq("system_id", sysId).order("date"),
    supabase.from("capper_baselines").select("*").eq("system_id", sysId),
    supabase.from("system_baselines").select("*").eq("system_id", sysId).maybeSingle(),
  ]);

  const system = sys as System;
  const journalRows = (journal ?? []) as JournalDayEntry[];
  const scalingRows = (scaling ?? []) as ScalingLogEntry[];
  const capperRows = (cappers ?? []) as Capper[];
  const allDayRows = (dayRows ?? []) as CapperDayEntry[];
  const baselines = (baselineRows ?? []) as CapperBaseline[];
  const systemBaselineRaw = (systemBaselineRow ?? null) as SystemBaseline | null;

  // restrict baselines to non-archived cappers (archived shouldn't count toward live totals)
  const activeCapperIds = new Set(capperRows.filter((c) => !c.is_archived).map((c) => c.id));
  const activeBaselines = baselines.filter((b) => activeCapperIds.has(b.capper_id));
  const baselineByCapper = new Map<string, CapperBaseline>();
  for (const b of activeBaselines) baselineByCapper.set(b.capper_id, b);
  // aggregate now folds in the optional system-level baseline too
  const systemBaseline = aggregateBaselines(activeBaselines, sysId, systemBaselineRaw);

  const focusDate = sp.date || journalRows.at(-1)?.date || todayISO();
  const dayJournal = journalRows.find((j) => j.date === focusDate);
  const journalSummary = summarizeJournal(journalRows);
  const summary = combineWithJournal(systemBaseline, journalSummary);

  /**
   * Dashboard green/red ROI math (per user spec, validated against
   * real exported data):
   *   - Cumulative = system_baseline + journal  (capper baselines do
   *     NOT contribute to the system-level cumulative; they live on
   *     each capper's page)
   *   - # Days = full aggregate (capper baselines + system baseline
   *     + journal) — same denominator as displayed elsewhere on the
   *     dashboard
   *   - Avg = Cumulative / # Days
   *
   * Verified end-to-end against the user's real export:
   *   green: cum 714.72 / 37 days = 19.32%
   *   red:  cum -507.36 / 34 days = -14.92%
   */
  const greenRoiCumDisplay =
    effectiveGreenCum(systemBaselineRaw) + journalSummary.greenRoiCum;
  const redRoiCumDisplay =
    effectiveRedCum(systemBaselineRaw) + journalSummary.redRoiCum;
  const greenAvgDisplay =
    summary.greenDays === 0 ? 0 : greenRoiCumDisplay / summary.greenDays;
  const redAvgDisplay =
    summary.redDays === 0 ? 0 : redRoiCumDisplay / summary.redDays;

  const activeRow = activeScalingRow(scalingRows, focusDate);
  // scaling progress now reflects baseline-included cumulative units
  const scaleState = computeScalingState(summary.cumulativeUnits, activeRow);

  // chart data — anchor at sum-of-baseline-units, then journal days add on top
  const baselineUnits = Number(systemBaseline?.cumulative_units_pnl ?? 0);
  const baselineDayOffset = systemBaseline?.total_betting_days ?? 0;
  const chartData: { day: number; date: string; cumulativeUnits: number; trendline: number | null }[] = [];
  if (systemBaseline) {
    chartData.push({
      day: baselineDayOffset,
      date: "baseline",
      cumulativeUnits: baselineUnits,
      trendline: null,
    });
  }
  journalRows.forEach((j, i) => {
    chartData.push({
      day: baselineDayOffset + i + 1,
      date: j.date,
      cumulativeUnits: baselineUnits + Number(j.cumulative_units_pnl),
      trendline: null,
    });
  });
  // simple trendline from first→last
  if (chartData.length > 1) {
    const first = chartData[0].cumulativeUnits;
    const last = chartData[chartData.length - 1].cumulativeUnits;
    chartData.forEach((p, i) => {
      const t = i / (chartData.length - 1);
      p.trendline = first + t * (last - first);
    });
  }

  // capper-on-the-day map
  const onDayByCapper = new Map<string, CapperDayEntry>();
  allDayRows.filter((d) => d.date === focusDate).forEach((d) => {
    onDayByCapper.set(d.capper_id, d);
  });
  // cumulative units per capper INCLUDING that capper's baseline
  const cumByCapper = new Map<string, number>();
  for (const d of allDayRows) {
    const baseUnits = Number(baselineByCapper.get(d.capper_id)?.cumulative_units_pnl ?? 0);
    cumByCapper.set(d.capper_id, baseUnits + Number(d.cumulative_units_pnl));
  }
  // include baseline-only cappers (no tracked days yet)
  for (const c of capperRows) {
    if (c.is_archived) continue;
    if (!cumByCapper.has(c.id)) {
      const b = baselineByCapper.get(c.id);
      cumByCapper.set(c.id, Number(b?.cumulative_units_pnl ?? 0));
    }
  }

  return (
    <div className="p-3 md:p-6 space-y-4 md:space-y-6" id="dashboard-root">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <div className="text-[10px] tracking-[0.4em] text-accent uppercase">
            {system?.name ?? "System"}
          </div>
          <h1 className="text-xl md:text-3xl font-bold">Betting System Dashboard</h1>
          <div className="text-ink-dim text-xs md:text-sm mt-1 flex flex-wrap items-center gap-1">
            <span>{summary.totalDays} betting days · 1u =&nbsp;</span>
            <span className="text-accent">${scaleState.currentUnitSize}</span>
            {scaleState.pendingDirection && (
              <span className="pill-info">
                → ${scaleState.pendingNextSize} ({scaleState.pendingDirection}) tomorrow
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <form className="flex gap-2 items-center">
            <input
              type="date"
              name="date"
              defaultValue={focusDate}
              className="input flex-1"
            />
            <button className="btn-ghost shrink-0" type="submit">Set</button>
          </form>
          <ExportButton targetId="dashboard-root" filename={`${system?.name ?? "system"}-${focusDate}.png`} />
        </div>
      </header>

      {/* top strip */}
      <div className="grid md:grid-cols-3 gap-4">
        <div className="panel p-4">
          <div className="kpi-label mb-1">Current Streak</div>
          <div className="flex items-center gap-3">
            <div
              className={
                "kpi-value font-mono " +
                (summary.currentStreakType === "green"
                  ? "text-good"
                  : summary.currentStreakType === "red"
                    ? "text-bad"
                    : "text-ink-dim")
              }
            >
              {summary.currentStreakValue}
            </div>
            <div
              className={
                "h-8 w-8 rounded grid place-items-center " +
                (summary.currentStreakType === "green"
                  ? "bg-good/15 text-good"
                  : summary.currentStreakType === "red"
                    ? "bg-bad/15 text-bad"
                    : "bg-muted/15 text-ink-dim")
              }
            >
              {summary.currentStreakType === "green" ? (
                <TrendingUp className="h-4 w-4" />
              ) : summary.currentStreakType === "red" ? (
                <TrendingDown className="h-4 w-4" />
              ) : (
                <Activity className="h-4 w-4" />
              )}
            </div>
          </div>
        </div>
        <div className="panel p-4">
          <div className="flex justify-between items-center mb-2">
            <div className="kpi-label">Scale Up Progress</div>
            <div className="text-accent font-mono">
              {scaleState.scaleUpProgressPct.toFixed(0)}%
            </div>
          </div>
          <div className="h-2 rounded-full bg-bg-panel overflow-hidden">
            <div
              className="h-full bg-accent"
              style={{ width: `${scaleState.scaleUpProgressPct}%` }}
            />
          </div>
          <div className="text-xs text-ink-dim mt-1 flex items-center justify-between gap-2">
            <span>{scaleState.bandStartUnits}u <span className="text-muted">scale↓</span></span>
            <span className="font-mono text-ink">
              {summary.cumulativeUnits.toFixed(2)}u
            </span>
            <span><span className="text-muted">scale↑</span> {scaleState.scaleUpAt}u</span>
          </div>
        </div>
        <div className="panel p-4">
          <div className="kpi-label mb-1">Level</div>
          <div className="kpi-value font-mono text-accent">
            ${scaleState.currentUnitSize}
            <span className="text-ink-dim text-base"> /unit</span>
          </div>
          <div className="text-xs text-ink-dim mt-1">
            Active since {activeRow?.effective_date ?? "—"}
          </div>
        </div>
      </div>

      {/* main chart */}
      <section className="panel p-5">
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="kpi-label flex items-center gap-2">
              Cumulative Units Over Time
              {systemBaseline && (
                <span className="pill-info">
                  starts at baseline {fmtUnits(baselineUnits)}
                </span>
              )}
            </div>
            <div className="text-2xl font-bold font-mono text-accent mt-0.5">
              {fmtUnits(summary.cumulativeUnits)}
            </div>
          </div>
          <div className="flex gap-3 text-xs text-ink-dim">
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-5 bg-accent inline-block" /> Cumulative Units
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-5 bg-warn inline-block border-dashed" /> Trendline
            </span>
          </div>
        </div>
        <CumulativeUnitsChart
          data={chartData}
          scaleUpAt={scaleState.scaleUpAt}
          scaleDownAt={scaleState.scaleDownAt}
        />
      </section>

      {/* performance summary */}
      <section className="grid lg:grid-cols-2 gap-4">
        <PerformanceSummary
          title={systemBaseline ? "Combined Performance Summary" : "Performance Summary"}
          badge={systemBaseline ? <span className="pill-info">baselines + tracked</span> : null}
          totalDays={summary.totalDays}
          totalBets={summary.totalBets}
          totalRisk={summary.totalRisk}
          cumulativeAmount={summary.cumulativeAmount}
          cumulativeUnits={summary.cumulativeUnits}
          runningRoi={summary.runningRoi}
          winRate={summary.winRate}
          wins={summary.wins}
          losses={summary.losses}
          greenDays={summary.greenDays}
          redDays={summary.redDays}
          greenAvgRoi={greenAvgDisplay}
          redAvgRoi={redAvgDisplay}
          greenRoiCum={greenRoiCumDisplay}
          redRoiCum={redRoiCumDisplay}
          greenProbability={summary.greenProbability}
          currentStreakType={summary.currentStreakType}
          currentStreakValue={summary.currentStreakValue}
          maxWinStreak={summary.maxWinStreak}
          maxLossStreak={summary.maxLossStreak}
        />

        <div className="panel p-3 md:p-5">
          <h3 className="kpi-label mb-3">Daily Summary — {focusDate}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <MiniStat label="Total # of bets" value={dayJournal?.total_bets ?? 0} />
            <MiniStat label="Total Risk" value={fmtMoney(dayJournal?.total_wager ?? 0)} />
            <MiniStat
              label="ROI"
              value={fmtPct(dayJournal?.daily_roi_percent ?? 0)}
              tone={dayJournal?.daily_roi_percent ?? 0}
            />
            <MiniStat
              label="Cumulative Units"
              value={fmtUnits(dayJournal?.daily_units_pnl ?? 0)}
              tone={dayJournal?.daily_units_pnl ?? 0}
            />
            <MiniStat
              label="Daily $ Profit"
              value={fmtMoney(dayJournal?.daily_amount_pnl ?? 0, { sign: true })}
              tone={dayJournal?.daily_amount_pnl ?? 0}
            />
            <MiniStat
              label="Win Rate"
              value={
                dayJournal
                  ? `${dayJournal.wins}-${dayJournal.losses} (${dayJournal.win_rate_percent.toFixed(0)}%)`
                  : "—"
              }
            />
          </div>
        </div>
      </section>

      {/* streak breakdown — system-level only: tracked journal runs + system baseline.
          Per-capper baselines stay scoped to their own capper page. */}
      <StreakBreakdown
        entries={mergeBreakdowns(
          streakBreakdown(journalRows),
          systemBaselineRaw?.streak_breakdown ?? null,
        )}
      />

      {/* capper summary */}
      <section className="panel p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="kpi-label">Capper Units Summary</h3>
          <div className="flex gap-3 text-[11px] text-ink-dim">
            <span>CUMULATIVE</span>
            <span>ON THE DAY</span>
          </div>
        </div>
        <div className="divide-y divide-border">
          {capperRows.length === 0 && (
            <div className="text-sm text-ink-dim py-4">
              No cappers yet.{" "}
              <Link href="/cappers" className="text-accent">Add your first capper →</Link>
            </div>
          )}
          {capperRows
            .filter((c) => !c.is_archived)
            .sort((a, b) => (cumByCapper.get(b.id) ?? 0) - (cumByCapper.get(a.id) ?? 0))
            .map((c) => {
              const cum = cumByCapper.get(c.id) ?? 0;
              const today = onDayByCapper.get(c.id);
              const todayUnits = today ? Number(today.daily_units_pnl) : 0;
              return (
                <div key={c.id} className="py-2 grid grid-cols-12 items-center gap-2">
                  <div className="col-span-6 flex items-center gap-3">
                    <PhasePill phase={c.current_phase} />
                    <Link
                      href={`/cappers/${c.id}`}
                      className="font-medium hover:text-accent"
                    >
                      {c.name}
                    </Link>
                  </div>
                  <div className={`col-span-3 text-right font-mono ${pctClass(cum)}`}>
                    {fmtUnits(cum)}
                  </div>
                  <div className={`col-span-3 text-right font-mono ${pctClass(todayUnits)}`}>
                    {fmtUnits(todayUnits)}
                  </div>
                </div>
              );
            })}
        </div>
      </section>

      {/* on the day footer */}
      <section className="panel p-5 flex items-center justify-between">
        <div className="kpi-label flex items-center gap-2">
          <Target className="h-4 w-4 text-accent" /> On the Day
        </div>
        <div
          className={`text-2xl font-bold font-mono ${pctClass(dayJournal?.daily_units_pnl ?? 0)}`}
        >
          {fmtUnits(dayJournal?.daily_units_pnl ?? 0)}
        </div>
      </section>
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: number;
}) {
  const cls =
    typeof tone === "number" ? (tone > 0 ? "text-good" : tone < 0 ? "text-bad" : "") : "";
  return (
    <div className="bg-bg-panel/60 rounded-md p-3">
      <div className="kpi-label text-[10px] mb-1">{label}</div>
      <div className={`font-mono text-base ${cls}`}>{value}</div>
    </div>
  );
}

function PhasePill({ phase }: { phase: "heater" | "lukewarm" | "cold" }) {
  if (phase === "heater")
    return (
      <span className="pill-good flex items-center gap-1">
        <Flame className="h-3 w-3" /> Heater
      </span>
    );
  if (phase === "cold")
    return (
      <span className="pill-bad flex items-center gap-1">
        <Snowflake className="h-3 w-3" /> Cold
      </span>
    );
  return <span className="pill-warn">Lukewarm</span>;
}
