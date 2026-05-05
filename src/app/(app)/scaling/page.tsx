import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadShellContext } from "@/lib/active-system";
import type { ScalingLogEntry } from "@/lib/types";
import { fmtMoney, todayISO } from "@/lib/utils";

export const dynamic = "force-dynamic";

async function addScaling(formData: FormData) {
  "use server";
  const sysId = String(formData.get("system_id"));
  const effective_date = String(formData.get("effective_date"));
  const unit_size_dollars = Number(formData.get("unit_size_dollars"));
  const starting_units_threshold = Number(formData.get("starting_units_threshold") || 0);
  const ending_units_threshold = Number(formData.get("ending_units_threshold") || 0);
  const bankroll = formData.get("bankroll") ? Number(formData.get("bankroll")) : null;
  const notes = String(formData.get("notes") || "").trim();
  if (!sysId || !effective_date || !unit_size_dollars) return;

  const supabase = createClient();
  await supabase.from("scaling_log_entries").insert({
    system_id: sysId,
    effective_date,
    unit_size_dollars,
    starting_units_threshold,
    ending_units_threshold,
    bankroll,
    notes: notes || null,
  });
  revalidatePath("/scaling");
  revalidatePath("/dashboard");
}

async function deleteScaling(formData: FormData) {
  "use server";
  const id = String(formData.get("id"));
  await createClient().from("scaling_log_entries").delete().eq("id", id);
  revalidatePath("/scaling");
  revalidatePath("/dashboard");
}

export default async function ScalingPage() {
  const ctx = await loadShellContext();
  if (!ctx) redirect("/login");
  const sysId = ctx.activeSystemId;
  const supabase = createClient();
  const { data } = await supabase
    .from("scaling_log_entries")
    .select("*")
    .eq("system_id", sysId)
    .order("effective_date", { ascending: false })
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as ScalingLogEntry[];

  return (
    <div className="p-6 space-y-6">
      <header>
        <div className="text-[10px] tracking-[0.4em] text-accent uppercase">Scaling Log</div>
        <h1 className="text-2xl font-bold">Unit size history</h1>
        <p className="text-ink-dim text-sm mt-1">
          New unit sizes apply from <strong>effective date</strong> forward. Add a row when you cross
          a +25u or -25u band — set effective_date to the day <em>after</em> the threshold was crossed.
        </p>
      </header>

      <form
        action={addScaling}
        className="panel p-4 grid md:grid-cols-6 gap-3 items-end"
      >
        <input type="hidden" name="system_id" value={sysId} />
        <div>
          <label className="label">Effective date</label>
          <input
            name="effective_date"
            type="date"
            defaultValue={todayISO()}
            required
            className="input"
          />
        </div>
        <div>
          <label className="label">Unit size ($)</label>
          <input name="unit_size_dollars" type="number" step="1" required className="input" />
        </div>
        <div>
          <label className="label">Band start (u)</label>
          <input name="starting_units_threshold" type="number" step="1" defaultValue={0} className="input" />
        </div>
        <div>
          <label className="label">Band end (u)</label>
          <input name="ending_units_threshold" type="number" step="1" defaultValue={25} className="input" />
        </div>
        <div>
          <label className="label">Bankroll ($)</label>
          <input name="bankroll" type="number" step="1" className="input" />
        </div>
        <div>
          <label className="label">Notes</label>
          <input name="notes" className="input" />
        </div>
        <div className="md:col-span-6">
          <button className="btn-primary">Add scaling entry</button>
        </div>
      </form>

      <div className="panel p-0">
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Effective</th>
                <th className="text-right">Unit size</th>
                <th className="text-right">Band</th>
                <th className="text-right">Bankroll</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-mono">{r.effective_date}</td>
                  <td className="text-right font-mono text-accent">
                    {fmtMoney(Number(r.unit_size_dollars))}
                  </td>
                  <td className="text-right font-mono">
                    {r.starting_units_threshold ?? 0}u → {r.ending_units_threshold ?? 0}u
                  </td>
                  <td className="text-right font-mono">
                    {r.bankroll != null ? fmtMoney(Number(r.bankroll)) : "—"}
                  </td>
                  <td className="text-ink-dim">{r.notes ?? ""}</td>
                  <td className="text-right">
                    <form action={deleteScaling}>
                      <input type="hidden" name="id" value={r.id} />
                      <button className="btn-danger text-xs">Delete</button>
                    </form>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center text-ink-dim py-6">
                    No scaling entries yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
