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
import {
  aggregateBaselines,
  combineWithJournal,
} from "@/lib/baseline";
import { mergeBreakdowns, streakBreakdown } from "@/lib/streaks";
import { linearRegression } from "@/lib/regression";
import {
  aggregateForPeriod,
  bucketRows,
  bucketStreakBreakdown,
  chartTooltipUnit,
  chartXAxisLabel,
  computeStreakAcrossBuckets,
  isInPeriod,
  periodColumnHeader,
  periodFooterLabel,
  resolvePeriod,
  streakUnitLabel,
  summaryTitle,
} from "@/lib/timeframe";
import ExportButton from "@/components/ExportButton";
import CumulativeUnitsChart from "@/components/charts/CumulativeUnitsChart";
import DailySummary from "@/components/DailySummary";
import PerformanceSummary from "@/components/PerformanceSummary";
import PeriodCalendar from "@/components/PeriodCalendar";
import StreakBreakdown from "@/components/StreakBreakdown";
import TimeframeNav from "@/components/TimeframeNav";
import {
  TrendingUp, TrendingDown, Flame, Snowflake, Activity, Target,
} from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Dashboard({
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

  /* -----------------------------------------------------------------
   * Timeframe resolution.
   *
   * The dashboard now supports Day, Week, Month, Year, All, and Custom
   * timeframes (see src/lib/timeframe.ts). Day reproduces the legacy
   * single-date behavior exactly; the other kinds re-bucket the journal
   * history and drive the chart, daily-summary panel, capper-units
   * column, bottom footer, and streak-card off the selected period.
   *
   * Things that intentionally do NOT change with the timeframe:
   *   - Scaling progress / Level cards (scaling is a lifetime concept)
   *   - PerformanceSummary panel (the "combined" lifetime aggregate)
   *   - Chart reference lines for scale up / scale down (lifetime)
   * --------------------------------------------------------------- */
  const period = resolvePeriod({
    timeframe: sp.timeframe,
    date: sp.date,
    from: sp.from,
    to: sp.to,
    fallbackDate: journalRows.at(-1)?.date ?? todayISO(),
  });
  const periodJournalRows = journalRows.filter((r) =>
    isInPeriod(r.date, period),
  );
  const periodAgg = aggregateForPeriod(periodJournalRows);

  // Streak math — bucket the FULL journal history by the timeframe's
  // bucket key (so week/month/year streaks consider all prior history),
  // EXCEPT for Custom range which the spec wants to reflect the exact
  // selected window only. Day-mode preserves its existing single-row
  // streak source (the SQL-computed current_streak_value on the journal
  // row) by ignoring the bucket result and falling back to `summary`.
  const streakRowsSource =
    period.kind === "custom" ? periodJournalRows : journalRows;
  const periodBuckets = bucketRows(streakRowsSource, period.bucketKey);
  const periodStreak = computeStreakAcrossBuckets(periodBuckets);
  const useDayModeStreak = period.kind === "day" || period.kind === "all";
  const displayStreakType = useDayModeStreak
    ? summary.currentStreakType
    : periodStreak.type;
  const displayStreakValue = useDayModeStreak
    ? summary.currentStreakValue
    : periodStreak.value;

  const activeRow = activeScalingRow(scalingRows, focusDate);
  // scaling progress now reflects baseline-included cumulative units
  // Scale-up progress reads the cumulative units total straight off
  // the journal's most recent date — same source of truth used by
  // the Combined Performance Summary panel and the chart. Aggregate
  // baseline values are intentionally NOT used here; the journal is
  // canonical (the Journal Baseline form imports pre-tracking history
  // into journal_day_entries so it's already included).
  const scaleState = computeScalingState(journalSummary.cumulativeUnits, activeRow);

  /**
   * Chart data assembly — JOURNAL-ONLY.
   *
   * Aggregate baselines (system_baselines, chart_baseline_points, and
   * capper_baselines) no longer contribute to this chart. Every point
   * is sourced from journal_day_entries directly. Pre-tracking history
   * imported via the Journal Baseline form already lives in
   * journal_day_entries (UNION'd by recompute_journal), so it shows up
   * naturally — no separate trajectory needed.
   *
   *   Day / All — plot every journal row in strict chronological order
   *   at its absolute cumulative_units_pnl. X-axis day numbers are
   *   sequential 1..N.
   *
   *   Week / Month / Year — collapse the journal rows into N-betting-
   *   day blocks (7 / 30 / 365). One data point per complete block at
   *   the cumulative value of the last day in the block, plus a
   *   trailing partial-block point so the user sees their in-progress
   *   position.
   *
   *   Custom — period-filtered journal rows only (already journal-only
   *   in the prior version).
   *
   *   Empty journal → empty chartData array → the chart renders just
   *   its axes (no line, no trendline). No baseline fallback.
   */
  const chartData: {
    day: number;
    date: string;
    cumulativeUnits: number;
    trendline: number | null;
  }[] = [];

  // Chart sourcing per tab:
  //   Day      → no chart (the hero block is an enlarged Daily Summary)
  //   Year     → no chart (the hero block is the year-month calendar)
  //   Week     → daily points across the focus week (Mon-Sun)
  //   Month    → daily points across the focus month
  //   Quarter  → daily points across the focus quarter
  //   All      → full-history daily points
  //   Custom   → period-filtered daily points
  //
  // Every visible chart variant plots in-period rows at their stored
  // cumulative_units_pnl, with sequential X-axis numbering 1..N.
  const showsChart =
    period.kind !== "day" && period.kind !== "year";
  if (showsChart) {
    const source =
      period.kind === "all" ? journalRows : periodJournalRows;
    source.forEach((j, i) => {
      chartData.push({
        day: i + 1,
        date: j.date,
        cumulativeUnits: Number(j.cumulative_units_pnl),
        trendline: null,
      });
    });
  }
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

  /**
   * Per-capper period-units: sum of daily_units_pnl over the days that
   * fall inside the active period. For Day mode this is just the
   * focus-date day's units (matches legacy behavior); for the other
   * timeframes it's the sum across all in-period days for that capper.
   */
  const periodUnitsByCapper = new Map<string, number>();
  for (const d of allDayRows) {
    if (!isInPeriod(d.date, period)) continue;
    periodUnitsByCapper.set(
      d.capper_id,
      (periodUnitsByCapper.get(d.capper_id) ?? 0) +
        Number(d.daily_units_pnl ?? 0),
    );
  }
  // Capper-on-the-day map kept for backwards compatibility with the
  // existing per-capper row layout — Day mode still renders identical
  // numbers to before.
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

      {/* timeframe nav — Day / Week / Month / Year / All + custom-range popover.
          Sits above the Current Streak / Scale Up / Level cards and acts as the
          dashboard's primary control surface for what date range every other
          panel summarizes. */}
      <TimeframeNav
        kind={period.kind}
        anchorDate={period.anchorDate}
        from={period.kind === "custom" ? period.start : null}
        to={period.kind === "custom" ? period.end : null}
      />

      {/* top strip */}
      <div className="grid md:grid-cols-3 gap-4">
        <div className="panel p-4">
          <div className="kpi-label mb-1 flex items-center gap-2">
            Current Streak
            <span className="text-[10px] text-ink-dim normal-case tracking-normal">
              ({period.bucketNoun}
              {displayStreakValue === 1 ? "" : "s"})
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div
              className={
                "kpi-value font-mono " +
                (displayStreakType === "green"
                  ? "text-good"
                  : displayStreakType === "red"
                    ? "text-bad"
                    : "text-ink-dim")
              }
            >
              {displayStreakValue}
            </div>
            <div
              className={
                "h-8 w-8 rounded grid place-items-center " +
                (displayStreakType === "green"
                  ? "bg-good/15 text-good"
                  : displayStreakType === "red"
                    ? "bg-bad/15 text-bad"
                    : "bg-muted/15 text-ink-dim")
              }
            >
              {displayStreakType === "green" ? (
                <TrendingUp className="h-4 w-4" />
              ) : displayStreakType === "red" ? (
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
              {journalSummary.cumulativeUnits.toFixed(2)}u
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

      {/* Hero block — what fills this slot depends on the active tab.
            Day      → enlarged Daily Summary, no chart
            Week     → chart of days across the focus week
            Month    → chart of days across the focus month
            Quarter  → chart of days across the focus quarter
            Year     → PeriodCalendar (year-month grid)
          The featured 3-metric strip renders below the hero on every
          tab. */}
      {period.kind === "year" ? (
        <PeriodCalendar
          period={{
            kind: period.kind,
            anchorDate: period.anchorDate,
            label: period.label,
            start: period.start,
            end: period.end,
          }}
          rows={journalRows}
        />
      ) : period.kind === "day" ? (
        <section className="panel p-5 md:p-6">
          <div className="kpi-label mb-3">{summaryTitle(period)}</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 md:gap-4">
            <HeroMetric
              label="Total # of bets"
              value={dayJournal?.total_bets ?? 0}
            />
            <HeroMetric
              label="Total Risk"
              value={fmtMoney(dayJournal?.total_wager ?? 0)}
            />
            <HeroMetric
              label="ROI"
              value={fmtPct(dayJournal?.daily_roi_percent ?? 0)}
              tone={dayJournal?.daily_roi_percent ?? 0}
            />
            <HeroMetric
              label="Daily Units"
              value={fmtUnits(dayJournal?.daily_units_pnl ?? 0)}
              tone={dayJournal?.daily_units_pnl ?? 0}
            />
            <HeroMetric
              label="Daily $ Profit"
              value={fmtMoney(dayJournal?.daily_amount_pnl ?? 0, { sign: true })}
              tone={dayJournal?.daily_amount_pnl ?? 0}
            />
            <HeroMetric
              label="Win Rate"
              value={
                dayJournal
                  ? `${dayJournal.wins}-${dayJournal.losses} (${dayJournal.win_rate_percent.toFixed(0)}%)`
                  : "—"
              }
              tone={
                dayJournal
                  ? Number(dayJournal.wins ?? 0) - Number(dayJournal.losses ?? 0)
                  : undefined
              }
            />
          </div>
        </section>
      ) : (
        // Week / Month / Quarter — daily-resolution chart filtered to the active period.
        <section className="panel p-5">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
            <div>
              <div className="kpi-label">
                {period.kind === "week"
                  ? "Weekly Performance"
                  : period.kind === "month"
                    ? "Monthly Performance"
                    : period.kind === "quarter"
                      ? "Quarterly Performance"
                      : "Cumulative Units Over Time"}
              </div>
              <div className="text-2xl font-bold font-mono text-accent mt-0.5">
                {fmtUnits(periodAgg.cumulativeUnits)}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
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
            xAxisLabel={chartXAxisLabel(period)}
            denseTicks={false}
            pointUnitLabel={chartTooltipUnit(period)}
          />
        </section>
      )}

      {/* Featured 3 metric cards — always visible regardless of tab.
          Profit / ROI / Record sourced from journalSummary (lifetime
          totals derived from journal_day_entries). */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <FeaturedMetric
          label="Profit"
          value={fmtMoney(journalSummary.cumulativeAmount, { sign: true })}
          sub={`Units: ${fmtUnits(journalSummary.cumulativeUnits)}`}
          tone={journalSummary.cumulativeAmount}
        />
        <FeaturedMetric
          label="ROI"
          value={fmtPct(journalSummary.runningRoi)}
          sub={`Risked: ${fmtMoney(journalSummary.totalRisk)}`}
          tone={journalSummary.runningRoi}
        />
        <FeaturedMetric
          label="Record"
          value={`${journalSummary.winRecord.w} - ${journalSummary.winRecord.l}`}
          sub={`Win: ${journalSummary.winRecord.rate.toFixed(2)}%`}
        />
      </section>

      {/* Combined Performance Summary — journal-only.
          Every metric in this panel is read directly from the
          journal_day_entries source via summarizeJournal(). Aggregate
          baselines (system_baselines, capper_baselines) NO LONGER
          contribute here. Pre-tracking history is captured via the
          Journal Baseline Importer (journal_baseline_days), which is
          UNION'd into journal_day_entries by recompute_journal — so
          those imported rows naturally show up in journalSummary
          alongside tracked rows. */}
      <section className="grid lg:grid-cols-2 gap-4">
        <PerformanceSummary
          title="Combined Performance Summary"
          totalDays={journalSummary.totalDays}
          totalBets={journalSummary.totalBets}
          totalRisk={journalSummary.totalRisk}
          cumulativeAmount={journalSummary.cumulativeAmount}
          cumulativeUnits={journalSummary.cumulativeUnits}
          runningRoi={journalSummary.runningRoi}
          winRate={journalSummary.winRecord.rate}
          wins={journalSummary.winRecord.w}
          losses={journalSummary.winRecord.l}
          greenDays={journalSummary.greenDays}
          redDays={journalSummary.redDays}
          // greenAvgRoi / redAvgRoi: mean ROI across the green / red
          // journal rows. summarizeJournal already keeps these as
          // averages over journal data only.
          greenAvgRoi={journalSummary.greenAvgRoi}
          redAvgRoi={journalSummary.redAvgRoi}
          // greenRoiCum / redRoiCum: sum of every green / red journal
          // day's ROI. recompute_journal stores the running total on
          // each day's row; the last row carries the cumulative value
          // (see calc.ts summarizeJournal).
          greenRoiCum={journalSummary.greenRoiCum}
          redRoiCum={journalSummary.redRoiCum}
          greenProbability={journalSummary.greenProbability}
          currentStreakType={journalSummary.streak.type}
          currentStreakValue={journalSummary.streak.value}
          maxWinStreak={journalSummary.maxWinStreak}
          maxLossStreak={journalSummary.maxLossStreak}
        />

        {/* Day-tab puts the full daily summary in the hero block at
            the top of the page, so we don't render it here a second
            time. Every other tab still gets a compact period-summary
            card alongside the Combined Performance Summary. */}
        {period.kind !== "day" && (
          <DailySummary
            focusDate={period.anchorDate}
            title={summaryTitle(period)}
            dayJournal={
              {
                id: "synthetic",
                system_id: sysId,
                date: period.anchorDate,
                total_wager: periodAgg.totalRisk,
                total_bets: periodAgg.totalBets,
                total_system_risk_cumulative: 0,
                daily_amount_pnl: periodAgg.cumulativeAmount,
                cumulative_amount_pnl: 0,
                daily_units_pnl: periodAgg.cumulativeUnits,
                cumulative_units_pnl: 0,
                daily_roi_percent: periodAgg.runningRoi,
                running_roi_percent: 0,
                wins: periodAgg.wins,
                losses: periodAgg.losses,
                win_rate_percent: periodAgg.winRate,
                record_wins: 0,
                record_losses: 0,
                green_day_count: periodAgg.greenDays,
                red_day_count: periodAgg.redDays,
                green_day_roi_cumulative: 0,
                red_day_roi_cumulative: 0,
                green_day_avg_roi: periodAgg.greenAvgRoi,
                red_day_avg_roi: periodAgg.redAvgRoi,
                green_day_probability: periodAgg.greenProbability,
                current_streak_value: displayStreakValue,
                current_streak_type: displayStreakType,
                max_win_streak: 0,
                max_loss_streak: 0,
                unit_size_used: null,
              } as JournalDayEntry
            }
          />
        )}
      </section>

      {/* streak breakdown — week/month/year modes bucket the full
          history into the chosen unit; day/all use existing per-day
          breakdown; custom uses the in-range daily rows only. System
          baseline streaks are folded in for daily / all only — they
          predate the buckets we'd want for week/month/year and don't
          translate cleanly. */}
      <StreakBreakdown
        entries={
          useDayModeStreak
            ? mergeBreakdowns(
                streakBreakdown(journalRows),
                systemBaselineRaw?.streak_breakdown ?? null,
              )
            : bucketStreakBreakdown(periodBuckets)
        }
        unitLabel={streakUnitLabel(period)}
      />

      {/* capper summary */}
      <section className="panel p-5">
        {/* Header uses the SAME 12-column grid as the data rows below,
            so the CUMULATIVE + period labels sit directly above their
            columns instead of clustering on the right. The section
            title takes col-span-6 to mirror the capper-name column;
            each metric label takes col-span-3 with text-right to
            match the value alignment. */}
        <div className="grid grid-cols-12 gap-2 items-center mb-3">
          <h3 className="kpi-label col-span-6">Capper Units Summary</h3>
          <div className="col-span-3 text-right text-[11px] text-ink-dim">
            CUMULATIVE
          </div>
          <div className="col-span-3 text-right text-[11px] text-ink-dim">
            {periodColumnHeader(period)}
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
              // Period-aware second column: Day mode keeps the single
              // focus-day value, the others sum all in-period days.
              const periodUnits =
                period.kind === "day"
                  ? Number(onDayByCapper.get(c.id)?.daily_units_pnl ?? 0)
                  : (periodUnitsByCapper.get(c.id) ?? 0);
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
                  <div className={`col-span-3 text-right font-mono ${pctClass(periodUnits)}`}>
                    {fmtUnits(periodUnits)}
                  </div>
                </div>
              );
            })}
        </div>
      </section>

      {/* period footer — label + value both swap with the active
          timeframe ("On the Week", "On the Month", etc.). Day mode
          keeps the original per-date number; everything else uses the
          period's aggregated units total. */}
      <section className="panel p-5 flex items-center justify-between">
        <div className="kpi-label flex items-center gap-2">
          <Target className="h-4 w-4 text-accent" /> {periodFooterLabel(period)}
        </div>
        {(() => {
          const value =
            period.kind === "day"
              ? Number(dayJournal?.daily_units_pnl ?? 0)
              : periodAgg.cumulativeUnits;
          return (
            <div
              className={`text-2xl font-bold font-mono ${pctClass(value)}`}
            >
              {fmtUnits(value)}
            </div>
          );
        })()}
      </section>
    </div>
  );
}

/**
 * Hero metric tile — used by the enlarged Day-tab Daily Summary block
 * that sits in the chart's slot. Larger than the regular DailySummary
 * tile (which it visually replaces on Day-tab) so the values read at
 * the same scale as a chart.
 */
function HeroMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
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
    <div className="bg-bg-panel/60 rounded-md p-4 md:p-5">
      <div className="kpi-label text-[10px] md:text-[11px] mb-2">{label}</div>
      <div className={`font-mono text-2xl md:text-3xl font-bold leading-none ${cls}`}>
        {value}
      </div>
    </div>
  );
}

/**
 * Featured metric card — used by the 3-up strip directly under the
 * hero chart. Largest visual weight on the page (after the chart):
 * uppercase label, oversized value, supporting line, tone-coded.
 */
function FeaturedMetric({
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
    <div className="panel border-accent/10 bg-bg-card/70 p-5 text-center">
      <div className="text-[10px] tracking-[0.3em] text-ink-dim uppercase mb-2">
        {label}
      </div>
      <div className={`text-3xl md:text-4xl font-bold font-mono leading-none ${cls}`}>
        {value}
      </div>
      {sub && (
        <div className="text-[11px] text-ink-dim font-mono mt-2">{sub}</div>
      )}
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
