import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createAdminClient, fetchAllRows } from "@/lib/supabase/admin";
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
  activeScalingRow,
  avgBetRiskFromJournal,
  avgDailyRiskFromJournal,
  computeScalingState,
  summarizeJournal,
} from "@/lib/calc";
import { aggregateBaselines, combineWithJournal } from "@/lib/baseline";
import { linearRegression } from "@/lib/regression";
import { averageAmericanOdds } from "@/lib/odds";
import { isSport, type Sport } from "@/lib/sports";
import {
  fmtMoney,
  fmtPct,
  fmtUnits,
  pctClass,
} from "@/lib/utils";
import PmLogo from "@/components/PmLogo";
import CumulativeUnitsChart from "@/components/charts/CumulativeUnitsChart";
import PerformanceSummary from "@/components/PerformanceSummary";
import ProfitabilityBySport, {
  type SportRow,
} from "@/components/ProfitabilityBySport";
import StreakBreakdown from "@/components/StreakBreakdown";
import { streakBreakdown, mergeBreakdowns } from "@/lib/streaks";
import { Flame, Snowflake } from "lucide-react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Public, read-only view of a betting system.
 *
 * Reached at /share/<share_token>. The token is resolved server-side
 * via the admin client; a missing or revoked (null) token 404s. No
 * auth, no edit controls, no cookies — this is a lifetime snapshot of
 * the system's performance that reuses the same presentational
 * components + calc helpers as the owner's dashboard.
 */
export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!token) notFound();

  const supabase = createAdminClient();
  const { data: sys } = await supabase
    .from("systems")
    .select("*")
    .eq("share_token", token)
    .maybeSingle();
  const system = sys as System | null;
  if (!system) notFound();

  const sysId = system.id;

  const [journalRows, scalingRows, capperRows, dayRows, baselineRows, { data: sysBaseRow }, betRows] =
    await Promise.all([
      fetchAllRows<JournalDayEntry>(() =>
        supabase.from("journal_day_entries").select("*").eq("system_id", sysId).order("date").order("id"),
      ),
      fetchAllRows<ScalingLogEntry>(() =>
        supabase.from("scaling_log_entries").select("*").eq("system_id", sysId).order("effective_date").order("id"),
      ),
      fetchAllRows<Capper>(() =>
        supabase.from("cappers").select("*").eq("system_id", sysId).order("sort_order").order("created_at"),
      ),
      fetchAllRows<CapperDayEntry>(() =>
        supabase.from("capper_day_entries").select("*").eq("system_id", sysId).order("date").order("id"),
      ),
      fetchAllRows<CapperBaseline>(() =>
        supabase.from("capper_baselines").select("*").eq("system_id", sysId).order("capper_id"),
      ),
      supabase.from("system_baselines").select("*").eq("system_id", sysId).maybeSingle(),
      fetchAllRows<{
        sport: string | null;
        bet_result: string;
        amount_pnl: number | string;
        capper_day_entry_id: string;
        odds: number | null;
      }>(() =>
        supabase
          .from("capper_bet_entries")
          .select("sport, bet_result, amount_pnl, capper_day_entry_id, odds, id")
          .eq("system_id", sysId)
          .order("id"),
      ),
    ]);

  const systemBaselineRaw = (sysBaseRow ?? null) as SystemBaseline | null;

  // Same include-archived rule the dashboard uses.
  const includeArchived = system.include_archived_in_system_metrics !== false;
  const eligibleCapperIds = new Set(
    capperRows
      .filter((c) => (includeArchived ? true : !c.is_archived && !c.is_deleted))
      .map((c) => c.id),
  );
  const activeBaselines = baselineRows.filter((b) => eligibleCapperIds.has(b.capper_id));
  const systemBaseline = aggregateBaselines(activeBaselines, sysId, systemBaselineRaw);

  const journalSummary = summarizeJournal(journalRows);
  const combined = combineWithJournal(systemBaseline, journalSummary);

  const latestDate = journalRows.at(-1)?.date ?? new Date().toISOString().slice(0, 10);
  const activeRow = activeScalingRow(scalingRows, latestDate);
  const scaleState = computeScalingState(journalSummary.cumulativeUnits, activeRow);

  const lifetimeAvgDailyRisk = avgDailyRiskFromJournal(journalRows, scalingRows);
  const lifetimeAvgBetRisk = avgBetRiskFromJournal(journalRows, scalingRows);

  // Cumulative-units chart — one point per journal date (all-time).
  const chartData: {
    day: number;
    date: string;
    cumulativeUnits: number;
    trendline: number | null;
  }[] = journalRows.map((j, i) => ({
    day: i + 1,
    date: j.date,
    cumulativeUnits: Number(j.cumulative_units_pnl),
    trendline: null,
  }));
  const fit = linearRegression(chartData.map((p) => ({ x: p.day, y: p.cumulativeUnits })));
  if (fit) {
    for (const p of chartData) p.trendline = fit.slope * p.day + fit.intercept;
  }

  // Profitability by Sport — lifetime, testing-phase excluded (same
  // rule as the dashboard: only day-level excluded_from_system gates).
  const includedDayIds = new Set(
    dayRows.filter((d) => !d.excluded_from_system).map((d) => d.id),
  );
  const sportAgg = new Map<Sport, SportRow>();
  for (const b of betRows) {
    if (b.bet_result !== "win" && b.bet_result !== "loss") continue;
    if (!includedDayIds.has(b.capper_day_entry_id)) continue;
    if (!isSport(b.sport)) continue;
    const key = b.sport as Sport;
    const cur = sportAgg.get(key) ?? { sport: key, wins: 0, losses: 0, netPnl: 0 };
    if (b.bet_result === "win") cur.wins += 1;
    else cur.losses += 1;
    cur.netPnl += Number(b.amount_pnl) || 0;
    sportAgg.set(key, cur);
  }
  const profitabilityBySport = [...sportAgg.values()];

  // Lifetime avg odds across graded bets carrying odds.
  const lifetimeAvgOdds = averageAmericanOdds(betRows.map((b) => b.odds));

  // Capper cumulative units (baseline + tracked), sorted desc.
  const baselineByCapper = new Map<string, CapperBaseline>();
  for (const b of activeBaselines) baselineByCapper.set(b.capper_id, b);
  const cumByCapper = new Map<string, number>();
  for (const d of dayRows) {
    const base = Number(baselineByCapper.get(d.capper_id)?.cumulative_units_pnl ?? 0);
    cumByCapper.set(d.capper_id, base + Number(d.cumulative_units_pnl));
  }
  for (const c of capperRows) {
    if (c.is_deleted) continue;
    if (!includeArchived && c.is_archived) continue;
    if (!cumByCapper.has(c.id)) {
      cumByCapper.set(c.id, Number(baselineByCapper.get(c.id)?.cumulative_units_pnl ?? 0));
    }
  }
  const visibleCappers = capperRows
    .filter((c) => !c.is_deleted && (includeArchived || !c.is_archived))
    .sort((a, b) => (cumByCapper.get(b.id) ?? 0) - (cumByCapper.get(a.id) ?? 0));

  return (
    <div className="min-h-screen">
      <div className="max-w-5xl mx-auto p-3 md:p-6 space-y-4 md:space-y-6">
        {/* Read-only banner */}
        <header className="relative">
          <div className="flex items-center justify-center gap-4 md:gap-8 py-4 md:py-6">
            <PmLogo variant="shield" className="h-12 md:h-16 w-auto shrink-0" />
            <div className="text-center min-w-0">
              <div className="text-base md:text-2xl font-extrabold tracking-[0.18em] text-ink uppercase leading-none">
                {system.name.toUpperCase()}
              </div>
              <div className="text-2xl md:text-4xl font-black italic tracking-[0.04em] text-accent uppercase leading-none mt-1 md:mt-2 drop-shadow-[0_0_18px_rgba(34,168,255,0.35)]">
                Betting System
              </div>
              <div className="mt-2 flex items-center justify-center gap-2 text-ink-dim">
                <span className="text-accent/60">&#x2666;</span>
                <span className="italic text-xs md:text-sm">
                  Read-only shared view
                </span>
                <span className="text-accent/60">&#x2666;</span>
              </div>
            </div>
            <PmLogo variant="shield" className="h-12 md:h-16 w-auto shrink-0" />
          </div>
        </header>

        {/* Featured lifetime metrics */}
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

        {/* Level / unit-size context (read-only) */}
        <section className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <MiniCard label="Current Unit Size" value={`$${scaleState.currentUnitSize}`} accent />
          <MiniCard label="Total Betting Days" value={String(combined.totalDays)} />
          <MiniCard label="Total Bets" value={String(journalSummary.totalBets)} />
        </section>

        {/* Cumulative units chart */}
        <section className="panel p-5">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
            <div>
              <div className="kpi-label">Cumulative Units Over Time</div>
              <div className="text-2xl font-bold font-mono text-accent mt-0.5">
                {fmtUnits(journalSummary.cumulativeUnits)}
              </div>
            </div>
          </div>
          <CumulativeUnitsChart
            data={chartData}
            scaleUpAt={scaleState.scaleUpAt}
            scaleDownAt={scaleState.scaleDownAt}
          />
        </section>

        {/* Combined performance summary */}
        <section>
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
            greenAvgRoi={journalSummary.greenAvgRoi}
            redAvgRoi={journalSummary.redAvgRoi}
            greenRoiCum={journalSummary.greenRoiCum}
            redRoiCum={journalSummary.redRoiCum}
            greenProbability={journalSummary.greenProbability}
            currentStreakType={journalSummary.streak.type}
            currentStreakValue={journalSummary.streak.value}
            maxWinStreak={journalSummary.maxWinStreak}
            maxLossStreak={journalSummary.maxLossStreak}
            lifetimeAvgOdds={lifetimeAvgOdds}
            lifetimeAvgDailyRisk={lifetimeAvgDailyRisk}
            lifetimeAvgBetRisk={lifetimeAvgBetRisk}
          />
        </section>

        {/* Profitability by sport (lifetime) */}
        <ProfitabilityBySport rows={profitabilityBySport} subtitle="All-time" />

        {/* Streak breakdown */}
        <StreakBreakdown
          entries={mergeBreakdowns(
            streakBreakdown(journalRows),
            systemBaselineRaw?.streak_breakdown ?? null,
          )}
        />

        {/* Capper units summary */}
        <section className="panel p-5">
          <div className="grid grid-cols-12 gap-2 items-center mb-3">
            <h3 className="kpi-label col-span-8">Capper Units Summary</h3>
            <div className="col-span-4 text-right text-[11px] text-ink-dim">
              CUMULATIVE
            </div>
          </div>
          <div className="divide-y divide-border">
            {visibleCappers.length === 0 && (
              <div className="text-sm text-ink-dim py-4">No cappers yet.</div>
            )}
            {visibleCappers.map((c) => {
              const cum = cumByCapper.get(c.id) ?? 0;
              return (
                <div key={c.id} className="py-2 grid grid-cols-12 items-center gap-2">
                  <div className="col-span-8 flex items-center gap-2 flex-wrap min-w-0">
                    <PhasePill phase={c.current_phase} />
                    <span className={`font-medium ${c.is_testing ? "text-ink-dim" : ""}`}>
                      {c.name}
                    </span>
                    {c.is_testing && <span className="pill-warn text-[10px]">Testing</span>}
                    {c.is_archived && <span className="pill-mute text-[10px]">Archived</span>}
                  </div>
                  <div className={`col-span-4 text-right font-mono ${pctClass(cum)}`}>
                    {fmtUnits(cum)}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <footer className="text-center text-[11px] text-ink-dim py-4">
          Read-only shared view · Phresh Mastery Betting System
        </footer>
      </div>
    </div>
  );
}

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
      {sub && <div className="text-[11px] text-ink-dim font-mono mt-2">{sub}</div>}
    </div>
  );
}

function MiniCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="panel p-4">
      <div className="kpi-label mb-1">{label}</div>
      <div className={`kpi-value font-mono ${accent ? "text-accent" : "text-ink"}`}>
        {value}
      </div>
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
