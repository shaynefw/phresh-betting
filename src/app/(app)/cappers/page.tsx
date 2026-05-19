import { revalidatePath } from "next/cache";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadShellContext } from "@/lib/active-system";
import type {
  Capper,
  CapperBaseline,
  CapperDayEntry,
  ScalingLogEntry,
} from "@/lib/types";
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

/**
 * Soft delete — never a hard DELETE.
 * Historical capper_day_entries / capper_bet_entries remain in the
 * database so the capper's contribution stays in the system journal
 * + dashboard aggregates (default behavior is "include archived &
 * deleted in system metrics"; the user can opt out in Settings).
 * Also clears `is_active` / `is_archived` so the row exists in exactly
 * one bucket (`is_deleted`) and can't appear in active/archived lists.
 * The cappers_archive_delete_change trigger fires recompute_journal
 * so dashboard metrics update immediately if the user has the setting
 * turned off.
 */
async function deleteCapper(formData: FormData) {
  "use server";
  const id = String(formData.get("id"));
  await createAdminClient().from("cappers").update({
    is_deleted: true,
    is_active: false,
    is_archived: false,
  }).eq("id", id);
  revalidatePath("/cappers");
  revalidatePath("/dashboard");
  revalidatePath("/journal");
}

async function restoreCapper(formData: FormData) {
  "use server";
  const id = String(formData.get("id"));
  await createAdminClient().from("cappers").update({
    is_deleted: false,
    is_active: true,
    is_archived: false,
  }).eq("id", id);
  revalidatePath("/cappers");
  revalidatePath("/dashboard");
  revalidatePath("/journal");
}

export default async function CappersPage() {
  const ctx = await loadShellContext();
  if (!ctx) redirect("/sign-in");
  const sysId = ctx.activeSystemId;
  const supabase = createAdminClient();
  const [
    { data: cappers },
    { data: scaling },
    { data: dayRows },
    { data: baselineRows },
  ] = await Promise.all([
    supabase.from("cappers").select("*").eq("system_id", sysId)
      .order("sort_order").order("created_at"),
    supabase.from("scaling_log_entries").select("*").eq("system_id", sysId).order("effective_date"),
    supabase.from("capper_day_entries").select("*").eq("system_id", sysId).order("date"),
    supabase.from("capper_baselines").select("*").eq("system_id", sysId),
  ]);

  const list = (cappers ?? []) as Capper[];
  const scalingRows = (scaling ?? []) as ScalingLogEntry[];
  const allDayRows = (dayRows ?? []) as CapperDayEntry[];
  const baselines = (baselineRows ?? []) as CapperBaseline[];
  const today = todayISO();
  const activeRow = activeScalingRow(scalingRows, today);
  const unitSize = activeRow?.unit_size_dollars ?? 0;

  const baselineByCapper = new Map<string, CapperBaseline>();
  for (const b of baselines) baselineByCapper.set(b.capper_id, b);

  // per-capper combined metrics (baseline + tracked)
  function statsFor(capperId: string) {
    const b = baselineByCapper.get(capperId);
    const days = allDayRows.filter((d) => d.capper_id === capperId);
    const trackedGreen = days.filter((d) => Number(d.daily_roi_percent) > 0).length;
    const trackedRed = days.filter((d) => Number(d.daily_roi_percent) < 0).length;
    const greenDays = (b?.green_day_count ?? 0) + trackedGreen;
    const redDays = (b?.red_day_count ?? 0) + trackedRed;
    const dayWinRate =
      greenDays + redDays === 0 ? 0 : (greenDays / (greenDays + redDays)) * 100;
    const last = days.at(-1);
    const trackedCum = Number(last?.cumulative_units_pnl ?? 0);
    const cumUnits = Number(b?.cumulative_units_pnl ?? 0) + trackedCum;
    const trackedRoi = Number(last?.running_roi_percent ?? 0);
    const trackedRisk = days.reduce((s, d) => s + Number(d.wager_total), 0);
    const trackedAmt = Number(last?.cumulative_amount_pnl ?? 0);
    const totalRisk = Number(b?.total_risk ?? 0) + trackedRisk;
    const totalAmt = Number(b?.cumulative_amount_pnl ?? 0) + trackedAmt;
    const runRoi = totalRisk === 0 ? trackedRoi : (totalAmt / totalRisk) * 100;
    return { greenDays, redDays, dayWinRate, cumUnits, runRoi };
  }

  // Active management list: visible, manageable cappers — excludes both
  // archived AND soft-deleted (those have their own sections / are hidden).
  const active = list
    .filter((c) => !c.is_archived && !c.is_deleted)
    .map((c) => ({ c, stats: statsFor(c.id) }))
    .sort((a, b) => b.stats.cumUnits - a.stats.cumUnits);
  // Archived only — excludes soft-deleted (treat archive and delete as
  // separate management buckets even though both default-include in
  // system metrics).
  const archived = list.filter((c) => c.is_archived && !c.is_deleted);
  // Soft-deleted — historical data still contributing to system metrics
  // by default. User can Restore to bring them back as Active, or flip
  // the Settings toggle to exclude them from collective metrics.
  const deleted = list.filter((c) => c.is_deleted);

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
        {active.map(({ c, stats }) => {
          const dollars = c.base_system_risk_units * unitSize;
          return (
            <div
              key={c.id}
              className={`panel p-3 ${c.is_testing ? "border-warn/40 bg-warn/5" : ""}`}
            >
              <div className="flex items-start justify-between mb-2 gap-2">
                <div className="min-w-0 flex items-center gap-2 flex-wrap">
                  <Link href={`/cappers/${c.id}`} className="font-semibold text-ink hover:text-accent">
                    {c.name}
                  </Link>
                  {c.is_testing && (
                    <span className="pill-warn text-[10px]">Testing</span>
                  )}
                </div>
                <form action={archiveCapper}>
                  <input type="hidden" name="id" value={c.id} />
                  <button className="btn-ghost text-[10px] py-1">Archive</button>
                </form>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs font-mono mb-2">
                <div>
                  <div className="kpi-label text-[9px]">Cum Units</div>
                  <div className={pctClass(stats.cumUnits)}>{fmtUnits(stats.cumUnits)}</div>
                </div>
                <div>
                  <div className="kpi-label text-[9px]">Run ROI</div>
                  <div className={pctClass(stats.runRoi)}>{fmtPct(stats.runRoi)}</div>
                </div>
                <div>
                  <div className="kpi-label text-[9px]">Risk</div>
                  <div>{c.base_system_risk_units}u · {fmtMoney(dollars)}</div>
                </div>
                <div>
                  <div className="kpi-label text-[9px]">Day Win Rate</div>
                  <div>{stats.greenDays}-{stats.redDays} ({stats.dayWinRate.toFixed(0)}%)</div>
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
                <th className="text-right">Day Win Rate</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {active.map(({ c, stats }) => {
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
                      <div className="flex items-center gap-2">
                        <Link href={`/cappers/${c.id}`} className="font-medium hover:text-accent">
                          {c.name}
                        </Link>
                        {c.is_testing && (
                          <span className="pill-warn text-[10px]">Testing</span>
                        )}
                      </div>
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
                    <td className={`text-right font-mono ${pctClass(stats.cumUnits)}`}>
                      {fmtUnits(stats.cumUnits)}
                    </td>
                    <td className={`text-right font-mono ${pctClass(stats.runRoi)}`}>
                      {fmtPct(stats.runRoi)}
                    </td>
                    <td className="text-right font-mono">
                      {stats.greenDays}-{stats.redDays} ({stats.dayWinRate.toFixed(0)}%)
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
          <h3 className="kpi-label mb-1">Archived</h3>
          <p className="text-xs text-ink-dim mb-3">
            Hidden from active management. Historical data still counts toward
            system-wide metrics by default (controlled in Settings).
          </p>
          <div className="divide-y divide-border">
            {archived.map((c) => (
              <div key={c.id} className="py-2 flex items-center justify-between">
                <div className="font-medium">{c.name}</div>
                <div className="flex gap-2">
                  <form action={unarchiveCapper}>
                    <input type="hidden" name="id" value={c.id} />
                    <button className="btn-ghost text-xs">Unarchive</button>
                  </form>
                  <form action={deleteCapper}>
                    <input type="hidden" name="id" value={c.id} />
                    <button className="btn-danger text-xs">Delete</button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {deleted.length > 0 && (
        <div className="panel p-5">
          <h3 className="kpi-label mb-1">Deleted</h3>
          <p className="text-xs text-ink-dim mb-3">
            Removed from active and archived management. Historical days +
            bets are preserved and continue to contribute to system metrics
            by default. Toggle "Include archived &amp; deleted cappers in
            system-wide metrics" in Settings to exclude them.
          </p>
          <div className="divide-y divide-border">
            {deleted.map((c) => (
              <div key={c.id} className="py-2 flex items-center justify-between">
                <div className="font-medium text-ink-dim">{c.name}</div>
                <div className="flex gap-2">
                  <form action={restoreCapper}>
                    <input type="hidden" name="id" value={c.id} />
                    <button className="btn-ghost text-xs">Restore</button>
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
