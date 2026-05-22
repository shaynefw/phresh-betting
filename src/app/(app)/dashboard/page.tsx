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
  ChartBaselinePoint,
  JournalDayEntry,
  ScalingLogEntry,
  System,
  SystemBaseline,
} from "@/lib/types";
import ChartBaselineImporter from "@/components/ChartBaselineImporter";
import {
  aggregateBaselines,
  combineWithJournal,
  effectiveGreenCum,
  effectiveRedCum,
} from "@/lib/baseline";
import { mergeBreakdowns, streakBreakdown } from "@/lib/streaks";
import { linearRegression } from "@/lib/regression";
import ExportButton from "@/components/ExportButton";
import CumulativeUnitsChart from "@/components/charts/CumulativeUnitsChart";
import DailySummary from "@/components/DailySummary";
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
    { data: chartPointRows },
  ] = await Promise.all([
    supabase.from("systems").select("*").eq("id", sysId).single(),
    supabase.from("journal_day_entries").select("*").eq("system_id", sysId).order("date"),
    supabase.from("scaling_log_entries").select("*").eq("system_id", sysId).order("effective_date"),
    supabase.from("cappers").select("*").eq("system_id", sysId).order("sort_order").order("created_at"),
    supabase.from("capper_day_entries").select("*").eq("system_id", sysId).order("date"),
    supabase.from("capper_baselines").select("*").eq("system_id", sysId),
    supabase.from("system_baselines").select("*").eq("system_id", sysId).maybeSingle(),
    supabase.from("chart_baseline_points").select("*").eq("system_id", sysId).is("capper_id", null).order("day_number"),
  ]);

  const system = sys as System;
  const journalRows = (journal ?? []) as JournalDayEntry[];
  const scalingRows = (scaling ?? []) as ScalingLogEntry[];
  const capperRows = (cappers ?? []) as Capper[];
  const allDayRows = (dayRows ?? []) as CapperDayEntry[];
  const baselines = (baselineRows ?? []) as CapperBaseline[];
  const systemBaselineRaw = (systemBaselineRow ?? null) as SystemBaseline | null;
  const chartPoints = (chartPointRows ?? []) as ChartBaselinePoint[];

  // System-level math: by default INCLUDE archived AND soft-deleted
  // cappers' baselines so the dashboard cumulative units, $ profit,
  // streak math, and progress bars never silently rewrite themselves
  // when a capper is archived or deleted. Users who want to exclude
  // those cappers can flip
  // systems.include_archived_in_system_metrics off in Settings.
  // (Testing-Phase exclusion is per-entry on capper_day_entries; it's
  // applied at the SQL layer by recompute_journal.)
  const includeArchived = system?.include_archived_in_system_metrics !== false;
  const eligibleCapperIds = new Set(
    capperRows
      .filter((c) =>
        includeArchived ? true : !c.is_archived && !c.is_deleted,
      )
      .map((c) => c.id),
  );
  const activeBaselines = baselines.filter((b) => eligibleCapperIds.has(b.capper_id));
  const baselineByCapper = new Map<string, CapperBaseline>();
  for (const b of activeBaselines) baselineByCapper.set(b.capper_id, b);
  // aggregate folds in the optional system-level baseline too
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

  /**
   * Chart data assembly:
   *   1. If the user imported chart baseline points, plot each as a
   *      day on the chart. Tracked data picks up from the last
   *      imported point's cumulative.
   *   2. Otherwise fall back to the legacy single-anchor behavior:
   *      one point at systemBaseline.cumulative_units_pnl, then
   *      tracked days continue from there.
   *   3. If neither, just plot tracked days starting at 0.
   */
  const sortedChartPoints = [...chartPoints].sort(
    (a, b) => a.day_number - b.day_number,
  );
  const chartData: { day: number; date: string; cumulativeUnits: number; trendline: number | null }[] = [];

  let trackedStartUnits = 0;
  let trackedDayOffset = 0;
  if (sortedChartPoints.length > 0) {
    sortedChartPoints.forEach((p) => {
      chartData.push({
        day: p.day_number,
        date: "",
        cumulativeUnits: Number(p.cumulative_units),
        trendline: null,
      });
    });
    const last = sortedChartPoints[sortedChartPoints.length - 1];
    trackedStartUnits = Number(last.cumulative_units);
    trackedDayOffset = last.day_number;
  } else if (systemBaseline) {
    trackedStartUnits = Number(systemBaseline.cumulative_units_pnl ?? 0);
    trackedDayOffset = systemBaseline.total_betting_days ?? 0;
    chartData.push({
      day: trackedDayOffset,
      date: "baseline",
      cumulativeUnits: trackedStartUnits,
      trendline: null,
    });
  }
  journalRows.forEach((j, i) => {
    chartData.push({
      day: trackedDayOffset + i + 1,
      date: j.date,
      cumulativeUnits: trackedStartUnits + Number(j.cumulative_units_pnl),
      trendline: null,
    });
  });
  // Ordinary least-squares regression line spanning the entire dataset
  // (Apple-Numbers-style line of best fit). Renders straight because
  // every row carries y = m*x + b at its real x value.
  const fit = linearRegression(
    chartData.map((p) => ({ x: p.day, y: p.cumulativeUnits })),
  );
  if (fit) {
    chartData.forEach((p) => {
      p.trendline = fit.slope * p.day + fit.intercept;
    });
  }

  // Compatibility alias used by the existing "starts at baseline" pill
  const baselineUnits = trackedStartUnits;

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
  // include baseline-only cappers (no tracked days yet). Soft-deleted
  // cappers are never shown in the per-capper management list even
  // when the setting includes them in collective metrics — only
  // archived cappers stay visible if they're still in the eligible set
  // (so the user can see what's contributing).
  for (const c of capperRows) {
    if (c.is_deleted) continue;
    if (!includeArchived && c.is_archived) continue;
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
        <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
          <div>
            <div className="kpi-label flex items-center gap-2 flex-wrap">
              Cumulative Units Over Time
              {sortedChartPoints.length > 0 && (
                <span className="pill-info">
                  {sortedChartPoints.length} baseline point
                  {sortedChartPoints.length === 1 ? "" : "s"} imported
                </span>
              )}
              {sortedChartPoints.length === 0 && systemBaseline && (
                <span className="pill-info">
                  starts at baseline {fmtUnits(baselineUnits)}
                </span>
              )}
            </div>
            <div className="text-2xl font-bold font-mono text-accent mt-0.5">
              {fmtUnits(summary.cumulativeUnits)}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ChartBaselineImporter
              systemId={sysId}
              capperId={null}
              initialPoints={chartPoints}
            />
            <div className="flex gap-3 text-xs text-ink-dim">
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-5 bg-accent inline-block" /> Cumulative Units
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="h-0.5 w-5 inline-block"
                  style={{ backgroundColor: "#d9d141" }}
                />{" "}
                Trendline
              </span>
            </div>
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

        <DailySummary focusDate={focusDate} dayJournal={dayJournal ?? null} />
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
            // Hide soft-deleted from the per-capper management list at
            // all times — their data is still in totals above when
            // include_archived_in_system_metrics is on, but they
            // shouldn't clutter the active-management panel.
            // Archived cappers stay visible here when their data is
            // contributing (so the user can see what's adding up).
            .filter((c) =>
              !c.is_deleted && (includeArchived || !c.is_archived),
            )
            .sort((a, b) => (cumByCapper.get(b.id) ?? 0) - (cumByCapper.get(a.id) ?? 0))
            .map((c) => {
              const cum = cumByCapper.get(c.id) ?? 0;
              const today = onDayByCapper.get(c.id);
              const todayUnits = today ? Number(today.daily_units_pnl) : 0;
              return (
                <div key={c.id} className="py-2 grid grid-cols-12 items-center gap-2">
                  <div className="col-span-6 flex items-center gap-2 flex-wrap min-w-0">
                    <PhasePill phase={c.current_phase} />
                    <Link
                      href={`/cappers/${c.id}`}
                      className={`font-medium hover:text-accent ${c.is_testing ? "text-ink-dim" : ""}`}
                    >
                      {c.name}
                    </Link>
                    {c.is_testing && (
                      <span className="pill-warn text-[10px]">Testing</span>
                    )}
                    {c.is_archived && (
                      <span
                        className="pill-mute text-[10px]"
                        title="Archived — historical data still contributing to system metrics (toggle in Settings to exclude)"
                      >
                        Archived
                      </span>
                    )}
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
