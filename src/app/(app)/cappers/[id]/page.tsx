import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadShellContext } from "@/lib/active-system";
import type {
  Capper,
  CapperBetEntry,
  CapperDayEntry,
  ScalingLogEntry,
} from "@/lib/types";
import { activeScalingRow } from "@/lib/calc";
import { fmtMoney, fmtPct, fmtUnits, pctClass, todayISO } from "@/lib/utils";
import CumulativeUnitsChart from "@/components/charts/CumulativeUnitsChart";
import ExportButton from "@/components/ExportButton";
import DayEntryForm from "./DayEntryForm";
import BetEntryEditor from "./BetEntryEditor";

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

  const [{ data: capper }, { data: days }, { data: bets }, { data: scaling }] = await Promise.all([
    supabase.from("cappers").select("*").eq("id", id).single(),
    supabase.from("capper_day_entries").select("*").eq("capper_id", id).order("date"),
    supabase.from("capper_bet_entries").select("*").eq("capper_id", id).order("date").order("created_at"),
    supabase.from("scaling_log_entries").select("*").eq("system_id", sysId).order("effective_date"),
  ]);

  if (!capper) notFound();
  const c = capper as Capper;
  // ownership check: capper must belong to the active system the user owns
  if (c.system_id !== sysId) notFound();
  const dayRows = (days ?? []) as CapperDayEntry[];
  const betRows = (bets ?? []) as CapperBetEntry[];
  const scalingRows = (scaling ?? []) as ScalingLogEntry[];
  const today = todayISO();
  const activeRow = activeScalingRow(scalingRows, today);
  const unitSize = activeRow?.unit_size_dollars ?? 0;

  const last = dayRows.at(-1);
  const cumUnits = Number(last?.cumulative_units_pnl ?? 0);
  const runRoi = Number(last?.running_roi_percent ?? 0);

  const chartData = dayRows.map((d, i) => ({
    day: i + 1,
    date: d.date,
    cumulativeUnits: Number(d.cumulative_units_pnl),
    trendline: null,
  }));

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
        <div className="flex gap-2">
          <Link href="/cappers" className="btn-ghost">All cappers</Link>
          <ExportButton targetId="capper-root" filename={`${c.name}.png`} />
        </div>
      </header>

      <section className="grid md:grid-cols-4 gap-3">
        <Stat label="Cumulative Units" value={fmtUnits(cumUnits)} tone={cumUnits} />
        <Stat label="Running ROI" value={fmtPct(runRoi)} tone={runRoi} />
        <Stat
          label="Win Rate"
          value={
            last
              ? `${last.record_wins}-${last.record_losses} (${last.win_rate_percent.toFixed(0)}%)`
              : "—"
          }
        />
        <Stat label="Days" value={dayRows.length} />
      </section>

      <section className="panel p-4">
        <div className="kpi-label mb-2">Cumulative Units — Trend</div>
        <CumulativeUnitsChart data={chartData} height={260} />
      </section>

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
    <div className="panel p-4">
      <div className="kpi-label mb-1">{label}</div>
      <div className={`kpi-value font-mono ${cls}`}>{value}</div>
    </div>
  );
}
