import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadShellContext } from "@/lib/active-system";
import type {
  Capper,
  CapperBaseline,
  CapperBetEntry,
  CapperDayEntry,
  ChartBaselinePoint,
  ScalingLogEntry,
  System,
  SystemBaseline,
} from "@/lib/types";
import BackupTools from "./BackupTools";
import SystemBaselineForm from "./SystemBaselineForm";

export const dynamic = "force-dynamic";

async function updateSystem(formData: FormData) {
  "use server";
  const id = String(formData.get("id"));
  const name = String(formData.get("name") || "").trim();
  const description = String(formData.get("description") || "");
  const notes = String(formData.get("notes") || "");
  if (!name) return;
  await createAdminClient().from("systems").update({
    name,
    description: description || null,
    notes: notes || null,
  }).eq("id", id);
  revalidatePath("/settings");
  revalidatePath("/", "layout");
}

/**
 * Toggle whether archived + soft-deleted cappers count toward system
 * aggregates (journal, dashboard summary, cumulative units chart,
 * scaling, progress bars, exports). Default = include (true).
 *
 * The SQL trigger `systems_include_archived_change` fires when this
 * column flips and runs `recompute_journal`, so the dashboard reflects
 * the new state on the very next render — no app-side recompute needed.
 */
async function updateIncludeArchived(formData: FormData) {
  "use server";
  const id = String(formData.get("id"));
  // Standard HTML form semantics: the checkbox sends its value only when
  // checked; an absent key means unchecked.
  const include = formData.get("include_archived_in_system_metrics") === "on";
  await createAdminClient()
    .from("systems")
    .update({ include_archived_in_system_metrics: include })
    .eq("id", id);
  revalidatePath("/settings");
  revalidatePath("/dashboard");
  revalidatePath("/journal");
  revalidatePath("/cappers");
}

export default async function SettingsPage() {
  const ctx = await loadShellContext();
  if (!ctx) redirect("/sign-in");
  const sysId = ctx.activeSystemId;
  const supabase = createAdminClient();
  const [
    { data: sys },
    { data: scaling },
    { data: cappers },
    { data: days },
    { data: bets },
    { data: baselines },
    { data: systemBaselineRow },
    { data: chartPointRows },
    { data: journalBaselineRows },
  ] = await Promise.all([
    supabase.from("systems").select("*").eq("id", sysId).single(),
    supabase.from("scaling_log_entries").select("*").eq("system_id", sysId).order("effective_date"),
    supabase.from("cappers").select("*").eq("system_id", sysId).order("created_at"),
    supabase.from("capper_day_entries").select("*").eq("system_id", sysId).order("date"),
    supabase.from("capper_bet_entries").select("*").eq("system_id", sysId).order("date"),
    supabase.from("capper_baselines").select("*").eq("system_id", sysId),
    supabase.from("system_baselines").select("*").eq("system_id", sysId).maybeSingle(),
    supabase.from("chart_baseline_points").select("*").eq("system_id", sysId).order("date"),
    supabase.from("journal_baseline_days").select("*").eq("system_id", sysId).order("date"),
  ]);

  const system = sys as System;
  const capperBaselines = (baselines ?? []) as CapperBaseline[];
  const systemBaseline = (systemBaselineRow ?? null) as SystemBaseline | null;
  const chartPoints = (chartPointRows ?? []) as ChartBaselinePoint[];

  const exportPayload = {
    version: 8,
    exported_at: new Date().toISOString(),
    system,
    scaling: (scaling ?? []) as ScalingLogEntry[],
    cappers: (cappers ?? []) as Capper[],
    capper_days: (days ?? []) as CapperDayEntry[],
    capper_bets: (bets ?? []) as CapperBetEntry[],
    capper_baselines: capperBaselines,
    system_baseline: systemBaseline,
    chart_baseline_points: chartPoints,
    // v8+ — per-date Daily Betting Journal baseline rows
    journal_baseline_days: (journalBaselineRows ?? []),
  };

  return (
    <div className="p-3 md:p-6 space-y-4 md:space-y-6">
      <header>
        <div className="text-[10px] tracking-[0.4em] text-accent uppercase">Settings</div>
        <h1 className="text-2xl font-bold">{system?.name}</h1>
      </header>

      <form action={updateSystem} className="panel p-5 grid md:grid-cols-2 gap-4">
        <input type="hidden" name="id" value={sysId} />
        <div>
          <label className="label">System name</label>
          <input name="name" defaultValue={system?.name} className="input" required />
        </div>
        <div>
          <label className="label">Description</label>
          <input name="description" defaultValue={system?.description ?? ""} className="input" />
        </div>
        <div className="md:col-span-2">
          <label className="label">Notes</label>
          <textarea name="notes" defaultValue={system?.notes ?? ""} className="input min-h-[100px]" />
        </div>
        <div className="md:col-span-2">
          <button className="btn-primary">Save settings</button>
        </div>
      </form>

      <form action={updateIncludeArchived} className="panel p-5 space-y-3">
        <input type="hidden" name="id" value={sysId} />
        <div>
          <div className="kpi-label">System Metrics — Inclusion Rules</div>
          <p className="text-xs text-ink-dim mt-1">
            Controls whether archived and deleted cappers' historical data
            contributes to collective system data: the Daily Betting Journal,
            dashboard summary, cumulative units chart, running ROI, progress
            bars, scaling state, exports, and any other system-wide totals.
            Individual capper pages are never affected.
          </p>
        </div>
        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            name="include_archived_in_system_metrics"
            defaultChecked={system?.include_archived_in_system_metrics !== false}
            className="mt-1 h-4 w-4 accent-accent"
          />
          <span className="text-sm">
            <span className="text-ink font-medium">
              Include archived &amp; deleted cappers in system-wide metrics
            </span>
            <span className="block text-xs text-ink-dim mt-1">
              <strong className="text-ink">Default · recommended.</strong>{" "}
              Archived and deleted cappers stay hidden from active
              management, but their historical days and bets continue to
              count toward every collective system total. Turning this off
              removes their contribution from all system aggregates;
              archive/delete an active capper while this is off and their
              data disappears from system totals immediately.
            </span>
          </span>
        </label>
        <div>
          <button className="btn-primary">Save inclusion rules</button>
        </div>
      </form>

      <SystemBaselineForm
        systemId={sysId}
        systemBaseline={systemBaseline}
        capperBaselines={capperBaselines}
      />

      <BackupTools systemId={sysId} payload={exportPayload} />
    </div>
  );
}
