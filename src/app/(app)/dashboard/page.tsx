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
  CapperDayEntry,
  JournalDayEntry,
  ScalingLogEntry,
  System,
} from "@/lib/types";
import Kpi from "@/components/Kpi";
import ExportButton from "@/components/ExportButton";
import CumulativeUnitsChart from "@/components/charts/CumulativeUnitsChart";
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

  const [{ data: sys }, { data: journal }, { data: scaling }, { data: cappers }, { data: dayRows }] =
    await Promise.all([
      supabase.from("systems").select("*").eq("id", sysId).single(),
      supabase.from("journal_day_entries").select("*").eq("system_id", sysId).order("date"),
      supabase.from("scaling_log_entries").select("*").eq("system_id", sysId).order("effective_date"),
      supabase.from("cappers").select("*").eq("system_id", sysId).order("sort_order").order("created_at"),
      supabase.from("capper_day_entries").select("*").eq("system_id", sysId).order("date"),
    ]);

  const system = sys as System;
  const journalRows = (journal ?? []) as JournalDayEntry[];
  const scalingRows = (scaling ?? []) as ScalingLogEntry[];
  const capperRows = (cappers ?? []) as Capper[];
  const allDayRows = (dayRows ?? []) as CapperDayEntry[];

  const focusDate = sp.date || journalRows.at(-1)?.date || todayISO();
  const dayJournal = journalRows.find((j) => j.date === focusDate);
  const summary = summarizeJournal(journalRows);
  const activeRow = activeScalingRow(scalingRows, focusDate);
  const scaleState = computeScalingState(summary.cumulativeUnits, activeRow);

  // chart data
  const chartData = journalRows.map((j, i) => {
    // simple linear trendline from first to last point
    const first = journalRows[0]?.cumulative_units_pnl ?? 0;
    const last = journalRows[journalRows.length - 1]?.cumulative_units_pnl ?? 0;
    const t = journalRows.length > 1 ? i / (journalRows.length - 1) : 0;
    return {
      day: i + 1,
      date: j.date,
      cumulativeUnits: Number(j.cumulative_units_pnl),
      trendline: first + t * (last - first),
    };
  });

  // capper-on-the-day map
  const onDayByCapper = new Map<string, CapperDayEntry>();
  allDayRows.filter((d) => d.date === focusDate).forEach((d) => {
    onDayByCapper.set(d.capper_id, d);
  });
  const cumByCapper = new Map<string, number>();
  for (const d of allDayRows) {
    cumByCapper.set(d.capper_id, Number(d.cumulative_units_pnl));
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
                (summary.streak.type === "green"
                  ? "text-good"
                  : summary.streak.type === "red"
                    ? "text-bad"
                    : "text-ink-dim")
              }
            >
              {summary.streak.value}
            </div>
            <div
              className={
                "h-8 w-8 rounded grid place-items-center " +
                (summary.streak.type === "green"
                  ? "bg-good/15 text-good"
                  : summary.streak.type === "red"
                    ? "bg-bad/15 text-bad"
                    : "bg-muted/15 text-ink-dim")
              }
            >
              {summary.streak.type === "green" ? (
                <TrendingUp className="h-4 w-4" />
              ) : summary.streak.type === "red" ? (
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
          <div className="text-xs text-ink-dim mt-1">
            {scaleState.unitsAboveBand.toFixed(2)}u above band ({scaleState.bandStartUnits}u →{" "}
            {scaleState.scaleUpAt}u)
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
            <div className="kpi-label">Cumulative Units Over Time</div>
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
        <div className="panel p-3 md:p-5">
          <h3 className="kpi-label mb-3">Performance Summary</h3>
          <div className="grid grid-cols-2 gap-y-2 text-sm">
            <Row label="Total # of betting days" value={summary.totalDays} />
            <Row
              label="Cumulative ($) Profit"
              value={fmtMoney(summary.cumulativeAmount, { sign: true })}
              tone={summary.cumulativeAmount}
            />
            <Row label="Total # of bets" value={summary.totalBets} />
            <Row
              label="Win Rate"
              value={`${summary.winRecord.w}-${summary.winRecord.l} (${summary.winRecord.rate.toFixed(0)}%)`}
            />
            <Row
              label="Total Risk"
              value={fmtMoney(summary.totalRisk)}
            />
            <Row
              label="# Green Days (Avg ROI)"
              tone={1}
              value={`${summary.greenDays} (${fmtPct(summary.greenAvgRoi)})`}
            />
            <Row
              label="ROI"
              tone={summary.runningRoi}
              value={fmtPct(summary.runningRoi)}
            />
            <Row
              label="# Red Days (Avg ROI)"
              tone={-1}
              value={`${summary.redDays} (${fmtPct(summary.redAvgRoi)})`}
            />
            <Row
              label="Cumulative Units"
              tone={summary.cumulativeUnits}
              value={fmtUnits(summary.cumulativeUnits)}
            />
            <Row
              label="Green Day Probability"
              value={`${summary.greenProbability.toFixed(0)}%`}
            />
          </div>
        </div>

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

function Row({
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
          : ""
      : "";
  return (
    <>
      <div className="text-ink-dim">{label}</div>
      <div className={`text-right font-mono ${cls}`}>{value}</div>
    </>
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
