import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadShellContext } from "@/lib/active-system";
import type {
  Capper,
  CapperBaseline,
  CapperBetEntry,
  CapperDayEntry,
  ScalingLogEntry,
} from "@/lib/types";
import { activeScalingRow } from "@/lib/calc";
import { combineWithDays } from "@/lib/baseline";
import { fmtMoney, fmtPct, fmtUnits, pctClass, todayISO } from "@/lib/utils";
import { mergeBreakdowns, streakBreakdown } from "@/lib/streaks";
import CumulativeUnitsChart from "@/components/charts/CumulativeUnitsChart";
import ExportButton from "@/components/ExportButton";
import PerformanceSummary from "@/components/PerformanceSummary";
import StreakBreakdown from "@/components/StreakBreakdown";
import DayEntryForm from "./DayEntryForm";
import BetEntryEditor from "./BetEntryEditor";
import BaselineForm from "./BaselineForm";
import TestingToggle from "./TestingToggle";

export const dynamic = "force-dynamic";

async function deleteDay(formData: FormData) {
  "use server";
  const id = String(formData.get("id"));
  const capperId = String(formData.get("capper_id"));
  await createAdminClient().from("capper_day_entries").delete().eq("id", id);
  revalidatePath(`/cappers/${capperId}`);
  revalidatePath("/dashboard");
  revalidatePath("/journal");
}

async function updateCapperMeta(formData: FormData) {
  "use server";
  const id = String(formData.get("id"));
  const name = String(formData.get("name") || "").trim();
  const risk = Number(formData.get("base_risk") || 0);
  const notes = String(formData.get("notes") || "");
  await createAdminClient().from("cappers").update({
    name,
    base_system_risk_units: risk,
    notes: notes || null,
  }).eq("id", id);
  revalidatePath(`/cappers/${id}`);
  revalidatePath("/cappers");
  revalidatePath("/dashboard");
}

export default async function CapperDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await loadShellContext();
  if (!ctx) redirect("/sign-in");
  const supabase = createAdminClient();
  const sysId = ctx.activeSystemId;

  const [{ data: capper }, { data: days }, { data: bets }, { data: scaling }, { data: baselineRow }] = await Promise.all([
    supabase.from("cappers").select("*").eq("id", id).single(),
    supabase.from("capper_day_entries").select("*").eq("capper_id", id).order("date"),
    supabase.from("capper_bet_entries").select("*").eq("capper_id", id).order("date").order("created_at"),
    supabase.from("scaling_log_entries").select("*").eq("system_id", sysId).order("effective_date"),
    supabase.from("capper_baselines").select("*").eq("capper_id", id).maybeSingle(),
  ]);

  if (!capper) notFound();
  const c = capper as Capper;
  // ownership check: capper must belong to the active system the user owns
  if (c.system_id !== sysId) notFound();
  const dayRows = (days ?? []) as CapperDayEntry[];
  const betRows = (bets ?? []) as CapperBetEntry[];
  const scalingRows = (scaling ?? []) as ScalingLogEntry[];
  const baseline = (baselineRow ?? null) as CapperBaseline | null;
  const today = todayISO();
  const activeRow = activeScalingRow(scalingRows, today);
  const unitSize = activeRow?.unit_size_dollars ?? 0;

  const combined = combineWithDays(baseline, dayRows);
  const cumUnits = combined.cumulativeUnits;
  const runRoi = combined.runningRoi;

  // chart: optional baseline anchor at day 0 (= baseline cumulative units),
  // then each tracked day adds on top.
  const baselineUnits = Number(baseline?.cumulative_units_pnl ?? 0);
  const baselineDayOffset = baseline?.total_betting_days ?? 0;
  const chartData: { day: number; date: string; cumulativeUnits: number; trendline: number | null }[] = [];
  if (baseline) {
    chartData.push({
      day: baselineDayOffset,
      date: "baseline",
      cumulativeUnits: baselineUnits,
      trendline: null,
    });
  }
  let runningUnits = baselineUnits;
  dayRows.forEach((d, i) => {
    runningUnits += Number(d.daily_units_pnl);
    chartData.push({
      day: baselineDayOffset + i + 1,
      date: d.date,
      cumulativeUnits: runningUnits,
      trendline: null,
    });
  });

  const betsByDay = new Map<string, CapperBetEntry[]>();
  for (const b of betRows) {
    const arr = betsByDay.get(b.capper_day_entry_id) ?? [];
    arr.push(b);
    betsByDay.set(b.capper_day_entry_id, arr);
  }

  return (
    <div className="p-3 md:p-6 space-y-4 md:space-y-6" id="capper-root">
      <header className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[10px] tracking-[0.4em] text-accent uppercase">
            Capper · {c.current_phase}
          </div>
          <h1 className="text-3xl font-bold">{c.name}</h1>
          <div className="text-ink-dim text-sm">
            System Risk: <span className="text-ink">{c.base_system_risk_units}u</span> ·{" "}
            <span className="text-accent">
              {fmtMoney(c.base_system_risk_units * unitSize)}
            </span>{" "}
            @ ${unitSize}/u
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!c.is_testing && (
            <TestingToggle capperId={c.id} systemId={sysId} isTesting={c.is_testing} />
          )}
          <BaselineForm capperId={c.id} systemId={sysId} baseline={baseline} />
          <Link href="/cappers" className="btn-ghost">All cappers</Link>
          <ExportButton targetId="capper-root" filename={`${c.name}.png`} />
        </div>
      </header>

      {c.is_testing && (
        <TestingToggle capperId={c.id} systemId={sysId} isTesting={c.is_testing} />
      )}

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Cumulative Units" value={fmtUnits(cumUnits)} tone={cumUnits} />
        <Stat label="Running ROI" value={fmtPct(runRoi)} tone={runRoi} />
        <Stat
          label="Win Rate"
          value={`${combined.wins}-${combined.losses} (${combined.winRate.toFixed(0)}%)`}
        />
        <Stat label="Days" value={combined.totalDays} />
      </section>

      <section className="panel p-4">
        <div className="kpi-label mb-2 flex items-center gap-2">
          Cumulative Units — Trend
          {baseline && (
            <span className="pill-info">starts at baseline {fmtUnits(baselineUnits)}</span>
          )}
        </div>
        <CumulativeUnitsChart data={chartData} height={260} />
      </section>

      {/* Performance summary + (optional) baseline / tracked split */}
      <section className="grid lg:grid-cols-2 gap-4">
        <PerformanceSummary
          title={baseline ? "Combined Performance Summary" : "Performance Summary"}
          badge={
            baseline ? (
              <span className="pill-info">baseline + tracked</span>
            ) : null
          }
          totalDays={combined.totalDays}
          totalBets={combined.totalBets}
          totalRisk={combined.totalRisk}
          cumulativeAmount={combined.cumulativeAmount}
          cumulativeUnits={combined.cumulativeUnits}
          runningRoi={combined.runningRoi}
          winRate={combined.winRate}
          wins={combined.wins}
          losses={combined.losses}
          greenDays={combined.greenDays}
          redDays={combined.redDays}
          greenAvgRoi={combined.greenAvgRoi}
          redAvgRoi={combined.redAvgRoi}
          greenRoiCum={combined.greenRoiCum}
          redRoiCum={combined.redRoiCum}
          greenProbability={combined.greenProbability}
          currentStreakType={combined.currentStreakType}
          currentStreakValue={combined.currentStreakValue}
          maxWinStreak={combined.maxWinStreak}
          maxLossStreak={combined.maxLossStreak}
        />

        {baseline ? (
          <BaselineSplit
            baseline={baseline}
            trackedDays={dayRows}
          />
        ) : (
          <div className="panel p-3 md:p-5 flex flex-col justify-center items-start gap-3">
            <div className="kpi-label">Historical baseline</div>
            <p className="text-sm text-ink-dim">
              No baseline set. If this capper has pre-app totals you want to roll forward, click
              <strong className="text-ink"> Set historical baseline</strong> at the top to seed
              starting metrics.
            </p>
          </div>
        )}
      </section>

      <StreakBreakdown
        entries={mergeBreakdowns(
          streakBreakdown(dayRows),
          baseline?.streak_breakdown ?? null,
        )}
      />

      <section className="grid lg:grid-cols-3 gap-4">
        <DayEntryForm capperId={c.id} systemId={sysId} unitSize={unitSize} />

        <div className="panel p-4 lg:col-span-2">
          <h3 className="kpi-label mb-3">Capper settings</h3>
          <form action={updateCapperMeta} className="grid md:grid-cols-3 gap-3">
            <input type="hidden" name="id" value={c.id} />
            <div>
              <label className="label">Name</label>
              <input name="name" defaultValue={c.name} className="input" required />
            </div>
            <div>
              <label className="label">Base risk (u)</label>
              <input name="base_risk" type="number" step="0.1" defaultValue={c.base_system_risk_units} className="input" />
            </div>
            <div>
              <label className="label">Notes</label>
              <input name="notes" defaultValue={c.notes ?? ""} className="input" />
            </div>
            <div className="md:col-span-3">
              <button className="btn-primary">Save</button>
            </div>
          </form>
        </div>
      </section>

      <section className="panel p-0">
        <div className="table-wrap">
          <table className="tbl font-mono">
            <thead>
              <tr>
                <th>Date</th>
                <th>Mode</th>
                <th className="text-right">Bets</th>
                <th className="text-right">Wager</th>
                <th className="text-right">$ PnL</th>
                <th className="text-right">Units</th>
                <th className="text-right">ROI</th>
                <th className="text-right">Cum Units</th>
                <th className="text-right">Run ROI</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {dayRows.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-center text-ink-dim py-6">
                    No days yet. Use “Add Date” on the left.
                  </td>
                </tr>
              )}
              {[...dayRows].reverse().map((d) => (
                <tr key={d.id} className="align-top">
                  <td>{d.date}</td>
                  <td className="text-ink-dim">
                    {d.entry_mode === "bet_level" ? "Bet-level" : "Daily"}
                  </td>
                  <td className="text-right">{d.bet_count}</td>
                  <td className="text-right">{fmtMoney(d.wager_total)}</td>
                  <td className={`text-right ${pctClass(d.daily_amount_pnl)}`}>
                    {fmtMoney(d.daily_amount_pnl, { sign: true })}
                  </td>
                  <td className={`text-right ${pctClass(d.daily_units_pnl)}`}>
                    {fmtUnits(d.daily_units_pnl)}
                  </td>
                  <td className={`text-right ${pctClass(d.daily_roi_percent)}`}>
                    {fmtPct(d.daily_roi_percent)}
                  </td>
                  <td className={`text-right ${pctClass(d.cumulative_units_pnl)}`}>
                    {fmtUnits(d.cumulative_units_pnl)}
                  </td>
                  <td className={`text-right ${pctClass(d.running_roi_percent)}`}>
                    {fmtPct(d.running_roi_percent)}
                  </td>
                  <td className="text-right">
                    <form action={deleteDay} className="inline-block">
                      <input type="hidden" name="id" value={d.id} />
                      <input type="hidden" name="capper_id" value={c.id} />
                      <button className="btn-danger text-xs">Delete</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* per-day bet editor for bet-level days */}
      {dayRows
        .filter((d) => d.entry_mode === "bet_level")
        .reverse()
        .map((d) => (
          <BetEntryEditor
            key={d.id}
            day={d}
            bets={betsByDay.get(d.id) ?? []}
            capperId={c.id}
            systemId={sysId}
          />
        ))}
    </div>
  );
}

function Stat({
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
    <div className="panel p-3 md:p-4">
      <div className="kpi-label mb-1">{label}</div>
      <div className={`kpi-value font-mono ${cls}`}>{value}</div>
    </div>
  );
}

function BaselineSplit({
  baseline,
  trackedDays,
}: {
  baseline: CapperBaseline;
  trackedDays: CapperDayEntry[];
}) {
  const trackedAmount = trackedDays.reduce((s, d) => s + Number(d.daily_amount_pnl), 0);
  const trackedUnits = trackedDays.reduce((s, d) => s + Number(d.daily_units_pnl), 0);
  const trackedBets = trackedDays.reduce((s, d) => s + Number(d.bet_count), 0);
  const trackedRisk = trackedDays.reduce((s, d) => s + Number(d.wager_total), 0);

  return (
    <div className="panel p-3 md:p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="kpi-label">Baseline + Tracked split</h3>
        <span className="pill-info">historical baseline</span>
      </div>
      <div className="grid grid-cols-3 text-sm gap-y-2">
        <div className="kpi-label text-[10px]">Metric</div>
        <div className="kpi-label text-[10px] text-right">Baseline</div>
        <div className="kpi-label text-[10px] text-right">Tracked</div>

        <SplitRow label="Days"
          a={baseline.total_betting_days}
          b={trackedDays.length} />
        <SplitRow label="Bets"
          a={baseline.total_bets}
          b={trackedBets} />
        <SplitRow label="$ Profit"
          a={fmtMoney(Number(baseline.cumulative_amount_pnl), { sign: true })}
          b={fmtMoney(trackedAmount, { sign: true })} />
        <SplitRow label="Units"
          a={fmtUnits(Number(baseline.cumulative_units_pnl))}
          b={fmtUnits(trackedUnits)} />
        <SplitRow label="Total Risk"
          a={fmtMoney(Number(baseline.total_risk))}
          b={fmtMoney(trackedRisk)} />
        <SplitRow label="Wins / Losses"
          a={`${baseline.wins}-${baseline.losses}`}
          b={`${trackedDays.reduce((s, d) => s + d.wins, 0)}-${trackedDays.reduce((s, d) => s + d.losses, 0)}`} />
        <SplitRow label="Green Days"
          a={baseline.green_day_count}
          b={trackedDays.filter((d) => Number(d.daily_roi_percent) > 0).length} />
        <SplitRow label="Red Days"
          a={baseline.red_day_count}
          b={trackedDays.filter((d) => Number(d.daily_roi_percent) < 0).length} />
      </div>
      {baseline.notes && (
        <p className="text-xs text-ink-dim mt-3 border-t border-border pt-2">
          <span className="kpi-label text-[10px] mr-2">Notes</span>
          {baseline.notes}
        </p>
      )}
    </div>
  );
}

function SplitRow({
  label,
  a,
  b,
}: {
  label: string;
  a: React.ReactNode;
  b: React.ReactNode;
}) {
  return (
    <>
      <div className="text-ink-dim">{label}</div>
      <div className="text-right font-mono text-ink-dim">{a}</div>
      <div className="text-right font-mono">{b}</div>
    </>
  );
}
