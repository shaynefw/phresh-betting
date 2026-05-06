import { revalidatePath } from "next/cache";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadShellContext } from "@/lib/active-system";
import type { Capper, CapperDayEntry, ScalingLogEntry } from "@/lib/types";
import { activeScalingRow } from "@/lib/calc";
import { fmtMoney, fmtPct, fmtUnits, pctClass, todayISO } from "@/lib/utils";
import AutoSubmitSelect from "@/components/AutoSubmitSelect";

export const dynamic = "force-dynamic";

async function addCapper(formData: FormData) {
  "use server";
  const sysId = String(formData.get("system_id"));
  const name = String(formData.get("name") || "").trim();
  const risk = Number(formData.get("base_risk") || 1);
  if (!name || !sysId) return;
  const supabase = createAdminClient();
  await supabase.from("cappers").insert({
    system_id: sysId,
    name,
    base_system_risk_units: risk,
  });
  revalidatePath("/cappers");
}

async function updatePhase(formData: FormData) {
  "use server";
  const id = String(formData.get("id"));
  const phase = String(formData.get("phase"));
  await createAdminClient().from("cappers").update({ current_phase: phase }).eq("id", id);
  revalidatePath("/cappers");
}

async function updateChecklist(formData: FormData) {
  "use server";
  const id = String(formData.get("id"));
  const checklist = String(formData.get("checklist"));
  await createAdminClient().from("cappers").update({ checklist_status: checklist }).eq("id", id);
  revalidatePath("/cappers");
}

async function archiveCapper(formData: FormData) {
  "use server";
  const id = String(formData.get("id"));
  await createAdminClient().from("cappers").update({ is_archived: true, is_active: false }).eq("id", id);
  revalidatePath("/cappers");
}

async function unarchiveCapper(formData: FormData) {
  "use server";
  const id = String(formData.get("id"));
  await createAdminClient().from("cappers").update({ is_archived: false, is_active: true }).eq("id", id);
  revalidatePath("/cappers");
}

async function deleteCapper(formData: FormData) {
  "use server";
  const id = String(formData.get("id"));
  await createAdminClient().from("cappers").delete().eq("id", id);
  revalidatePath("/cappers");
}

export default async function CappersPage() {
  const ctx = await loadShellContext();
  if (!ctx) redirect("/sign-in");
  const sysId = ctx.activeSystemId;
  const supabase = createAdminClient();
  const [{ data: cappers }, { data: scaling }, { data: dayRows }] = await Promise.all([
    supabase.from("cappers").select("*").eq("system_id", sysId)
      .order("sort_order").order("created_at"),
    supabase.from("scaling_log_entries").select("*").eq("system_id", sysId).order("effective_date"),
    supabase.from("capper_day_entries").select("*").eq("system_id", sysId).order("date"),
  ]);

  const list = (cappers ?? []) as Capper[];
  const scalingRows = (scaling ?? []) as ScalingLogEntry[];
  const allDayRows = (dayRows ?? []) as CapperDayEntry[];
  const today = todayISO();
  const activeRow = activeScalingRow(scalingRows, today);
  const unitSize = activeRow?.unit_size_dollars ?? 0;

  // build per-capper rollups (use last day row per capper)
  const lastByCapper = new Map<string, CapperDayEntry>();
  for (const d of allDayRows) {
    const prev = lastByCapper.get(d.capper_id);
    if (!prev || prev.date < d.date) lastByCapper.set(d.capper_id, d);
  }

  const active = list.filter((c) => !c.is_archived);
  const archived = list.filter((c) => c.is_archived);

  return (
    <div className="p-3 md:p-6 space-y-4 md:space-y-6">
      <header>
        <div className="text-[10px] tracking-[0.4em] text-accent uppercase">Cappers</div>
        <h1 className="text-xl md:text-2xl font-bold">Capper Performance Overview</h1>
        <div className="text-ink-dim text-xs md:text-sm">
          1u = <span className="text-accent">${unitSize}</span>
        </div>
      </header>

      <form action={addCapper} className="panel p-4 grid md:grid-cols-4 gap-3 items-end">
        <input type="hidden" name="system_id" value={sysId} />
        <div>
          <label className="label">Capper name</label>
          <input name="name" required className="input" placeholder="Underground Lab" />
        </div>
        <div>
          <label className="label">Base system risk (units)</label>
          <input name="base_risk" type="number" step="0.1" defaultValue={1} className="input" />
        </div>
        <div className="md:col-span-2">
          <button className="btn-primary">Add capper</button>
        </div>
      </form>

      {/* mobile stacked cards */}
      <div className="md:hidden space-y-2">
        {active.length === 0 && (
          <p className="text-sm text-ink-dim text-center py-4">No cappers yet.</p>
        )}
        {active.map((c) => {
          const last = lastByCapper.get(c.id);
          const cum = Number(last?.cumulative_units_pnl ?? 0);
          const roi = Number(last?.running_roi_percent ?? 0);
          const dollars = c.base_system_risk_units * unitSize;
          return (
            <div key={c.id} className="panel p-3">
              <div className="flex items-start justify-between mb-2">
                <Link href={`/cappers/${c.id}`} className="font-semibold text-ink hover:text-accent">
                  {c.name}
                </Link>
                <form action={archiveCapper}>
                  <input type="hidden" name="id" value={c.id} />
                  <button className="btn-ghost text-[10px] py-1">Archive</button>
                </form>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs font-mono mb-2">
                <div>
                  <div className="kpi-label text-[9px]">Cum Units</div>
                  <div className={pctClass(cum)}>{fmtUnits(cum)}</div>
                </div>
                <div>
                  <div className="kpi-label text-[9px]">Run ROI</div>
                  <div className={pctClass(roi)}>{fmtPct(roi)}</div>
                </div>
                <div>
                  <div className="kpi-label text-[9px]">Risk</div>
                  <div>{c.base_system_risk_units}u · {fmtMoney(dollars)}</div>
                </div>
                <div>
                  <div className="kpi-label text-[9px]">Record</div>
                  <div>{last ? `${last.record_wins}-${last.record_losses}` : "—"}</div>
                </div>
              </div>
              <div className="flex gap-2">
                <form action={updatePhase} className="flex-1">
                  <input type="hidden" name="id" value={c.id} />
                  <AutoSubmitSelect
                    name="phase"
                    defaultValue={c.current_phase}
                    options={[
                      { value: "heater", label: "Heater" },
                      { value: "lukewarm", label: "Lukewarm" },
                      { value: "cold", label: "Cold" },
                    ]}
                  />
                </form>
                <form action={updateChecklist} className="flex-1">
                  <input type="hidden" name="id" value={c.id} />
                  <AutoSubmitSelect
                    name="checklist"
                    defaultValue={c.checklist_status}
                    options={[
                      { value: "started", label: "Started" },
                      { value: "complete", label: "Complete" },
                    ]}
                  />
                </form>
              </div>
            </div>
          );
        })}
      </div>

      {/* desktop table */}
      <div className="panel p-0 hidden md:block">
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Checklist</th>
                <th>Capper</th>
                <th>Phase</th>
                <th className="text-right">System Risk</th>
                <th className="text-right">Cumulative Units</th>
                <th className="text-right">ROI</th>
                <th className="text-right">Win Rate</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {active.map((c) => {
                const last = lastByCapper.get(c.id);
                const dollars = c.base_system_risk_units * unitSize;
                return (
                  <tr key={c.id}>
                    <td>
                      <form action={updateChecklist} className="inline-block">
                        <input type="hidden" name="id" value={c.id} />
                        <AutoSubmitSelect
                          name="checklist"
                          defaultValue={c.checklist_status}
                          options={[
                            { value: "started", label: "Started" },
                            { value: "complete", label: "Complete" },
                          ]}
                        />
                      </form>
                    </td>
                    <td>
                      <Link href={`/cappers/${c.id}`} className="font-medium hover:text-accent">
                        {c.name}
                      </Link>
                    </td>
                    <td>
                      <form action={updatePhase} className="inline-block">
                        <input type="hidden" name="id" value={c.id} />
                        <AutoSubmitSelect
                          name="phase"
                          defaultValue={c.current_phase}
                          options={[
                            { value: "heater", label: "Heater" },
                            { value: "lukewarm", label: "Lukewarm" },
                            { value: "cold", label: "Cold" },
                          ]}
                        />
                      </form>
                    </td>
                    <td className="text-right font-mono">
                      {c.base_system_risk_units}u
                      <span className="text-ink-dim ml-1">({fmtMoney(dollars)})</span>
                    </td>
                    <td className={`text-right font-mono ${pctClass(Number(last?.cumulative_units_pnl ?? 0))}`}>
                      {fmtUnits(Number(last?.cumulative_units_pnl ?? 0))}
                    </td>
                    <td className={`text-right font-mono ${pctClass(Number(last?.running_roi_percent ?? 0))}`}>
                      {fmtPct(Number(last?.running_roi_percent ?? 0))}
                    </td>
                    <td className="text-right font-mono">
                      {last
                        ? `${last.record_wins}-${last.record_losses} (${last.win_rate_percent.toFixed(0)}%)`
                        : "—"}
                    </td>
                    <td className="text-right">
                      <form action={archiveCapper} className="inline-block">
                        <input type="hidden" name="id" value={c.id} />
                        <button className="btn-ghost text-xs">Archive</button>
                      </form>
                    </td>
                  </tr>
                );
              })}
              {active.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center text-ink-dim py-6">
                    No cappers yet. Add one above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {archived.length > 0 && (
        <div className="panel p-5">
          <h3 className="kpi-label mb-3">Archived</h3>
          <div className="divide-y divide-border">
            {archived.map((c) => (
              <div key={c.id} className="py-2 flex items-center justify-between">
                <div className="font-medium">{c.name}</div>
                <div className="flex gap-2">
                  <form action={unarchiveCapper}>
                    <input type="hidden" name="id" value={c.id} />
                    <button className="btn-ghost text-xs">Restore</button>
                  </form>
                  <form action={deleteCapper}>
                    <input type="hidden" name="id" value={c.id} />
                    <button className="btn-danger text-xs">Delete forever</button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
