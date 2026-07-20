import { redirect } from "next/navigation";
import Link from "next/link";
import { createAdminClient, fetchAllRows } from "@/lib/supabase/admin";
import { loadShellContext } from "@/lib/active-system";
import {
  activeScalingRow,
  avgBetRiskFromJournal,
  avgDailyRiskFromJournal,
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
  periodProfitLabel,
  periodUnitsLabel,
  resolvePeriod,
  streakUnitLabel,
  summaryTitle,
} from "@/lib/timeframe";
import ExportButton from "@/components/ExportButton";
import PmLogo from "@/components/PmLogo";
import ProfitabilityBySport from "@/components/ProfitabilityBySport";
import { isSport, type Sport } from "@/lib/sports";
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
    journalAll,
    { data: scaling },
    { data: cappers },
    dayRowsAll,
    { data: baselineRows },
    { data: systemBaselineRow },
    { data: chartPointRows },
    betRowsAll,
  ] = await Promise.all([
    supabase.from("systems").select("*").eq("id", sysId).single(),
    // journal_day_entries, capper_day_entries and the sport-bet fetch
    // are all system-wide and can exceed PostgREST's 1000-row default
    // cap on an active system. Page through the full result set (see
    // fetchAllRows) so the newest rows never silently drop — a capped
    // fetch here is what made the capper overview lag the capper page.
    fetchAllRows<JournalDayEntry>(() =>
      supabase.from("journal_day_entries").select("*").eq("system_id", sysId).order("date").order("id"),
    ),
    supabase.from("scaling_log_entries").select("*").eq("system_id", sysId).order("effective_date"),
    supabase.from("cappers").select("*").eq("system_id", sysId).order("sort_order").order("created_at"),
    fetchAllRows<CapperDayEntry>(() =>
      supabase.from("capper_day_entries").select("*").eq("system_id", sysId).order("date").order("id"),
    ),
    supabase.from("capper_baselines").select("*").eq("system_id", sysId),
    supabase.from("system_baselines").select("*").eq("system_id", sysId).maybeSingle(),
    supabase.from("chart_baseline_points").select("*").eq("system_id", sysId).is("capper_id", null).order("day_number"),
    // Skinny bet fetch for the Profitability-by-Sport panel: only the
    // fields we aggregate, only graded bets with a sport assigned.
    // Period filtering happens in the TS layer so the same fetch
    // serves whichever timeframe the user selects. `id` is appended as
    // a deterministic sort key for pagination.
    fetchAllRows<{
      sport: string | null;
      bet_result: string;
      amount_pnl: number | string;
      date: string;
      capper_day_entry_id: string;
      capper_id: string;
    }>(() =>
      supabase
        .from("capper_bet_entries")
        .select("sport, bet_result, amount_pnl, date, capper_day_entry_id, capper_id, id")
        .eq("system_id", sysId)
        .not("sport", "is", null)
        .in("bet_result", ["win", "loss"])
        .order("id"),
    ),
  ]);
  const journal = journalAll;
  const dayRows = dayRowsAll;
  const betRowsRaw = betRowsAll;

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

  // Lifetime risk metrics — surfaced in the Combined Performance
  // Summary at the bottom of the dashboard. Two distinct sources kept
  // strictly separate per product spec:
  //   - Avg Daily Risk = mean of each day's Total Unit Risk
  //   - Avg Bet Risk   = mean of each day's Avg Bet Risk
  // Neither appears in the per-period / journal panels above.
  const lifetimeAvgDailyRisk = avgDailyRiskFromJournal(
    journalRows,
    scalingRows,
  );
  const lifetimeAvgBetRisk = avgBetRiskFromJournal(journalRows, scalingRows);

  /**
   * Profitability by Sport — aggregate REALIZED, sport-tagged bets in
   * the active timeframe.
   *
   * Filter rules per product spec — intentionally different from the
   * rest of the dashboard's system-metric rules:
   *
   *   1. Realized only: bet_result must be win/loss (pending + void
   *      are already filtered out at the SQL fetch).
   *
   *   2. Testing-phase exclusion is the ONLY day-level gate: a bet's
   *      parent capper_day_entry must have excluded_from_system =
   *      false. That flag is stamped per-day at write time, so if a
   *      capper is flipped INTO testing phase later, their previously
   *      realized days remain in the metric (historical-data
   *      integrity). New bets logged while in testing phase get the
   *      flag and are correctly excluded.
   *
   *   3. Data permanence: archived OR soft-deleted cappers stay in
   *      the metric — once realized data exists, only a hard delete
   *      removes it from the DB and therefore from this panel. We do
   *      NOT consult eligibleCapperIds /
   *      include_archived_in_system_metrics here.
   *
   *   4. Sport must be in our known set (legacy free-text tags
   *      are skipped — there shouldn't be any, but the guard is
   *      defensive).
   *
   * Period scope is applied per-bet via the bet's own `date` column
   * so Day / Week / Month / Quarter / Year / Custom / All all just
   * work without any branching here.
   */
  const includedDayIds = new Set(
    allDayRows
      .filter((d) => !d.excluded_from_system)
      .map((d) => d.id),
  );
  const betsForPanel = (betRowsRaw ?? []) as Array<{
    sport: string | null;
    bet_result: string;
    amount_pnl: number | string;
    date: string;
    capper_day_entry_id: string;
    capper_id: string;
  }>;
  const sportAgg = new Map<
    Sport,
    { sport: Sport; wins: number; losses: number; netPnl: number }
  >();
  for (const b of betsForPanel) {
    if (!includedDayIds.has(b.capper_day_entry_id)) continue;
    if (!isInPeriod(b.date, period)) continue;
    if (!isSport(b.sport)) continue;
    const key = b.sport as Sport;
    const cur =
      sportAgg.get(key) ?? { sport: key, wins: 0, losses: 0, netPnl: 0 };
    if (b.bet_result === "win") cur.wins += 1;
    else if (b.bet_result === "loss") cur.losses += 1;
    cur.netPnl += Number(b.amount_pnl) || 0;
    sportAgg.set(key, cur);
  }
  const profitabilityBySport = [...sportAgg.values()];

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

  // Lifetime cumulative-units chart, bucketed by the active tab's
  // interval (per spec — "lifetime cumulative units changes plotted
  // at that tab's specific interval").
  //
  //   Day      → one point per journal date
  //   Week     → one point per Mon-Sun bucket
  //   Month    → one point per YYYY-MM
  //   Quarter  → one point per YYYY-Qn
  //   Year     → one point per YYYY
  //
  // For each bucket we keep the LAST journal row (by date), which
  // carries the cumulative position at the end of that bucket — so
  // the chart traces the running cum-units curve across history at
  // whatever resolution the tab represents.
  if (journalRows.length > 0) {
    const bucketEnd = new Map<string, (typeof journalRows)[number]>();
    for (const j of journalRows) {
      const k = period.bucketKey(j.date);
      const cur = bucketEnd.get(k);
      if (!cur || j.date > cur.date) bucketEnd.set(k, j);
    }
    const ordered = [...bucketEnd.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, j]) => j);
    ordered.forEach((j, i) => {
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
      {/* Centered banner — matches the reference branding treatment.
          Shield-PM badges flank the wordmark; the "<date> Results"
          line below stays in sync with whichever timeframe tab is
          active by reading period.label (Day → "Jun 10, 2026", Week
          → "Week of May 18 — May 24, 2026", Month → "May 2026", etc.).
          Date picker + export controls live on a separate row beneath
          so they don't pull the banner off-center. */}
      <header className="relative">
        <div className="flex items-center justify-center gap-4 md:gap-8 py-4 md:py-6">
          <PmLogo
            variant="shield"
            className="h-14 md:h-20 w-auto shrink-0"
          />
          <div className="text-center min-w-0">
            <div className="text-base md:text-2xl font-extrabold tracking-[0.18em] text-ink uppercase leading-none">
              {(system?.name ?? "Phresh Mastery").toUpperCase()}&rsquo;S
            </div>
            <div className="text-2xl md:text-5xl font-black italic tracking-[0.04em] text-accent uppercase leading-none mt-1 md:mt-2 drop-shadow-[0_0_18px_rgba(34,168,255,0.35)]">
              Betting System
            </div>
            <div className="mt-2 md:mt-3 flex items-center justify-center gap-2 text-ink-dim">
              <span className="text-accent/60">&#x2666;</span>
              <span className="italic text-sm md:text-base">
                {period.label} Results
              </span>
              <span className="text-accent/60">&#x2666;</span>
            </div>
          </div>
          <PmLogo
            variant="shield"
            className="h-14 md:h-20 w-auto shrink-0"
          />
        </div>

        {/* Controls row — date picker + PNG export. Set below the
            banner so the centered branding stays visually balanced. */}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <form className="flex gap-2 items-center">
            <input
              type="date"
              name="date"
              defaultValue={focusDate}
              className="input flex-1"
            />
            <button className="btn-ghost shrink-0" type="submit">Set</button>
          </form>
          <ExportButton
            targetId="dashboard-root"
            filename={`${system?.name ?? "system"}-${focusDate}.png`}
          />
          {scaleState.pendingDirection && (
            <span className="pill-info">
              1u → ${scaleState.pendingNextSize} ({scaleState.pendingDirection}) tomorrow
            </span>
          )}
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

      {/* 1. Lifetime cumulative units chart — same component on every
            tab, with the data bucketed at the tab's interval
            (chartData is built upstream per period.bucketKey). */}
      <section className="panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
          <div>
            <div className="kpi-label">Cumulative Units Over Time</div>
            <div className="text-2xl font-bold font-mono text-accent mt-0.5">
              {fmtUnits(journalSummary.cumulativeUnits)}
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
          pointUnitLabel={chartTooltipUnit(period)}
        />
      </section>

      {/* 2. Featured 3 metric cards — always visible directly under
            the chart on every tab. Profit / ROI / Record sourced from
            journalSummary (lifetime totals derived from journal_day_
            entries). */}
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

      {/* 3. Tab-specific section below the featured strip.
            Day        → Daily Summary (the focus date's per-day KPIs)
            Week       → PnL calendar of days in the focus week
            Month      → PnL calendar of days in the focus month
            Quarter    → PnL calendar of weeks in the focus quarter
            Year       → PnL calendar of months in the focus year
          The PnL calendar variants own their own anchor state so the
          prev / next arrows page through history without touching
          the dashboard's global filters. */}
      {period.kind === "day" ? (
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
              label={periodUnitsLabel(period)}
              value={fmtUnits(dayJournal?.daily_units_pnl ?? 0)}
              tone={dayJournal?.daily_units_pnl ?? 0}
            />
            <HeroMetric
              label={periodProfitLabel(period)}
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
      )}

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
          lifetimeAvgDailyRisk={lifetimeAvgDailyRisk}
          lifetimeAvgBetRisk={lifetimeAvgBetRisk}
        />

        {/* Day-tab puts the full daily summary in the hero block at
            the top of the page, so we don't render it here a second
            time. Every other tab still gets a compact period-summary
            card alongside the Combined Performance Summary. */}
        {period.kind !== "day" && (
          <DailySummary
            focusDate={period.anchorDate}
            title={summaryTitle(period)}
            profitLabel={periodProfitLabel(period)}
            unitsLabel={periodUnitsLabel(period)}
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

      {/* Profitability by Sport — aggregates graded bets within the
          active timeframe by their assigned sport. Same scope rules
          as the journal-driven panels above so the numbers reconcile. */}
      <ProfitabilityBySport
        rows={profitabilityBySport}
        subtitle={period.label}
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
