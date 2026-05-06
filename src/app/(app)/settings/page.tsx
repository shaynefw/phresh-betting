import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadShellContext } from "@/lib/active-system";
import type {
  Capper,
  CapperBetEntry,
  CapperDayEntry,
  ScalingLogEntry,
  System,
} from "@/lib/types";
import BackupTools from "./BackupTools";

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

export default async function SettingsPage() {
  const ctx = await loadShellContext();
  if (!ctx) redirect("/sign-in");
  const sysId = ctx.activeSystemId;
  const supabase = createAdminClient();
  const [{ data: sys }, { data: scaling }, { data: cappers }, { data: days }, { data: bets }] =
    await Promise.all([
      supabase.from("systems").select("*").eq("id", sysId).single(),
      supabase.from("scaling_log_entries").select("*").eq("system_id", sysId).order("effective_date"),
      supabase.from("cappers").select("*").eq("system_id", sysId).order("created_at"),
      supabase.from("capper_day_entries").select("*").eq("system_id", sysId).order("date"),
      supabase.from("capper_bet_entries").select("*").eq("system_id", sysId).order("date"),
    ]);

  const system = sys as System;
  const exportPayload = {
    version: 1,
    exported_at: new Date().toISOString(),
    system,
    scaling: (scaling ?? []) as ScalingLogEntry[],
    cappers: (cappers ?? []) as Capper[],
    capper_days: (days ?? []) as CapperDayEntry[],
    capper_bets: (bets ?? []) as CapperBetEntry[],
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

      <BackupTools systemId={sysId} payload={exportPayload} />
    </div>
  );
}
