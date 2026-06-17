import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadShellContext } from "@/lib/active-system";
import type {
  JournalDayEntry,
  ScalingLogEntry,
} from "@/lib/types";
import {
  BANKROLL_UNITS,
  bankrollForUnit,
  enrichScalingRows,
  type ScalingSequence,
} from "@/lib/calc";
import { fmtMoney, fmtUnits, todayISO } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Add a new scaling entry.
 *
 *   - bankroll is derived as unit × BANKROLL_UNITS — the form doesn't
 *     ask for it.
 *   - notes column is no longer surfaced; we leave it null on insert
 *     so existing rows that have a value aren't disturbed.
 *   - level / direction / sequence-of-days / avg-risked / total-risked
 *     are derived at render time from the journal, so the only fields
 *     the user supplies are effective_date, unit_size_dollars, and the
 *     optional band [start, end].
 */
async function addScaling(formData: FormData) {
  "use server";
  const sysId = String(formData.get("system_id"));
  const effective_date = String(formData.get("effective_date"));
  const unit_size_dollars = Number(formData.get("unit_size_dollars"));
  const starting_units_threshold = Number(
    formData.get("starting_units_threshold") || 0,
  );
  const ending_units_threshold = Number(
    formData.get("ending_units_threshold") || 25,
  );
  if (!sysId || !effective_date || !unit_size_dollars) return;

  const supabase = createAdminClient();
  await supabase.from("scaling_log_entries").insert({
    system_id: sysId,
    effective_date,
    unit_size_dollars,
    starting_units_threshold,
    ending_units_threshold,
    bankroll: bankrollForUnit(unit_size_dollars),
    notes: null,
  });
  revalidatePath("/scaling");
  revalidatePath("/dashboard");
}

async function updateScaling(formData: FormData) {
  "use server";
  const id = String(formData.get("id"));
  const effective_date = String(formData.get("effective_date"));
  const unit_size_dollars = Number(formData.get("unit_size_dollars"));
  const starting_units_threshold = Number(
    formData.get("starting_units_threshold") || 0,
  );
  const ending_units_threshold = Number(
    formData.get("ending_units_threshold") || 25,
  );
  if (!id || !effective_date || !unit_size_dollars) return;

  await createAdminClient()
    .from("scaling_log_entries")
    .update({
      effective_date,
      unit_size_dollars,
      starting_units_threshold,
      ending_units_threshold,
      bankroll: bankrollForUnit(unit_size_dollars),
    })
    .eq("id", id);
  revalidatePath("/scaling");
  revalidatePath("/dashboard");
}

async function deleteScaling(formData: FormData) {
  "use server";
  const id = String(formData.get("id"));
  await createAdminClient().from("scaling_log_entries").delete().eq("id", id);
  revalidatePath("/scaling");
  revalidatePath("/dashboard");
}

/**
 * Rebuild derived columns on every row in the active system. Today this
 * just normalizes bankroll = unit × 50 — the rest of the derived
 * columns (level, direction, sequenceOfDays, avgRisked, totalRisked)
 * are computed at render time so they're always live.
 */
async function rebuildScalingHistory(formData: FormData) {
  "use server";
  const sysId = String(formData.get("system_id"));
  if (!sysId) return;
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("scaling_log_entries")
    .select("id, unit_size_dollars")
    .eq("system_id", sysId);
  for (const r of data ?? []) {
    await supabase
      .from("scaling_log_entries")
      .update({ bankroll: bankrollForUnit(Number(r.unit_size_dollars)) })
      .eq("id", r.id);
  }
  revalidatePath("/scaling");
  revalidatePath("/dashboard");
}

export default async function ScalingPage() {
  const ctx = await loadShellContext();
  if (!ctx) redirect("/sign-in");
  const sysId = ctx.activeSystemId;
  const supabase = createAdminClient();

  const [{ data: scalingRows }, { data: journalRows }] = await Promise.all([
    supabase
      .from("scaling_log_entries")
      .select("*")
      .eq("system_id", sysId)
      .order("effective_date", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("journal_day_entries")
      .select("date,total_wager")
      .eq("system_id", sysId)
      .order("date", { ascending: true }),
  ]);

  const scaling = (scalingRows ?? []) as ScalingLogEntry[];
  const journal = (journalRows ?? []) as Pick<
    JournalDayEntry,
    "date" | "total_wager"
  >[];
  // enrichScalingRows sorts ascending internally; we want descending for display
  // (newest first), so reverse after enrichment.
  const enriched = enrichScalingRows(scaling, journal, todayISO()).slice().reverse();

  return (
    <div className="p-3 md:p-6 space-y-4 md:space-y-6">
      <header>
        <div className="text-[10px] tracking-[0.4em] text-accent uppercase">
          Scaling Log
        </div>
        <h1 className="text-2xl font-bold">Unit size history</h1>
        <p className="text-ink-dim text-sm mt-1">
          Add a row when cumulative units cross +25u (scale up) or -25u
          (scale down) of the active band. Set the effective date to the
          day <em>after</em> the threshold was crossed. Bankroll, level,
          direction, sequence of days and risk totals are derived
          automatically — bankroll always equals unit&nbsp;×&nbsp;
          {BANKROLL_UNITS}.
        </p>
      </header>

      {/* Add new scaling entry */}
      <form
        action={addScaling}
        className="panel p-4 grid md:grid-cols-5 gap-3 items-end"
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
          <input
            name="unit_size_dollars"
            type="number"
            step="1"
            min="1"
            required
            className="input"
          />
          <div className="text-[11px] text-ink-dim mt-1">
            Bankroll auto-set to unit × {BANKROLL_UNITS}.
          </div>
        </div>
        <div>
          <label className="label">Band start (u)</label>
          <input
            name="starting_units_threshold"
            type="number"
            step="1"
            defaultValue={0}
            className="input"
          />
        </div>
        <div>
          <label className="label">Band end (u)</label>
          <input
            name="ending_units_threshold"
            type="number"
            step="1"
            defaultValue={25}
            className="input"
          />
        </div>
        <div>
          <button className="btn-primary w-full">Add scaling entry</button>
        </div>
      </form>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <form action={rebuildScalingHistory}>
          <input type="hidden" name="system_id" value={sysId} />
          <button className="btn-ghost text-xs" title="Re-normalize bankroll = unit × 50 on every row">
            Recalculate history
          </button>
        </form>
        <div className="text-[11px] text-ink-dim">
          {enriched.length === 0
            ? "No scaling entries yet."
            : `${enriched.length} ${enriched.length === 1 ? "entry" : "entries"}.`}
        </div>
      </div>

      {/* Scaling log table */}
      <div className="panel p-0">
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Effective</th>
                <th className="text-right">Scale Lvl</th>
                <th className="text-center">Direction</th>
                <th className="text-right">Seq. of Days</th>
                <th className="text-right">Unit Size</th>
                <th className="text-right">Band</th>
                <th className="text-right">Bankroll</th>
                <th className="text-right">Avg Risked</th>
                <th className="text-right">Total Risked</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {enriched.map((s) => (
                <ScalingRow key={s.row.id} s={s} />
              ))}
              {enriched.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-center text-ink-dim py-6">
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

function ScalingRow({ s }: { s: ScalingSequence }) {
  const r = s.row;
  return (
    <>
      <tr>
        <td className="font-mono">{r.effective_date}</td>
        <td className="text-right font-mono">{s.level}</td>
        <td className="text-center font-mono text-lg leading-none">
          <DirectionIcon dir={s.direction} />
        </td>
        <td className="text-right font-mono">
          {s.sequenceOfDays}
          {s.isCurrent && (
            <span className="ml-1 text-[10px] text-accent uppercase tracking-wider">
              live
            </span>
          )}
        </td>
        <td className="text-right font-mono text-accent">
          {fmtMoney(Number(r.unit_size_dollars))}
        </td>
        <td className="text-right font-mono">
          {Number(r.starting_units_threshold ?? 0)}u →{" "}
          {Number(r.ending_units_threshold ?? 0)}u
        </td>
        <td className="text-right font-mono">{fmtMoney(s.bankroll)}</td>
        <td className="text-right font-mono">
          {fmtMoney(s.avgRiskedAmount)}{" "}
          <span className="text-ink-dim">
            [{fmtUnits(s.avgRiskedUnits)}]
          </span>
        </td>
        <td className="text-right font-mono">
          {fmtMoney(s.totalRiskedAmount)}{" "}
          <span className="text-ink-dim">
            [{fmtUnits(s.totalRiskedUnits)}]
          </span>
        </td>
        <td className="text-right">
          {/* Toggle target: the inline edit row below this one is shown
              via the :checked pseudo-class on its sibling checkbox. */}
          <label
            htmlFor={`edit-${r.id}`}
            className="btn-ghost text-xs cursor-pointer"
          >
            Edit
          </label>
        </td>
      </tr>
      <tr className="scaling-edit-row">
        <td colSpan={10} className="p-0 border-t-0">
          <input
            id={`edit-${r.id}`}
            type="checkbox"
            className="peer sr-only"
          />
          <div className="hidden peer-checked:block bg-bg-panel/40 border-t border-border p-3 md:p-4">
            <EditForm s={s} />
          </div>
        </td>
      </tr>
    </>
  );
}

function DirectionIcon({ dir }: { dir: "up" | "down" | "neutral" }) {
  if (dir === "up") return <span className="text-good">↑</span>;
  if (dir === "down") return <span className="text-bad">↓</span>;
  return <span className="text-ink-dim">—</span>;
}

function EditForm({ s }: { s: ScalingSequence }) {
  const r = s.row;
  return (
    <div className="space-y-3">
      <form action={updateScaling} className="space-y-2">
        <input type="hidden" name="id" value={r.id} />
        <div>
          <label className="label">Effective</label>
          <input
            name="effective_date"
            type="date"
            defaultValue={r.effective_date}
            required
            className="input"
          />
        </div>
        <div>
          <label className="label">Unit size ($)</label>
          <input
            name="unit_size_dollars"
            type="number"
            step="1"
            min="1"
            defaultValue={Number(r.unit_size_dollars)}
            required
            className="input"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">Band start</label>
            <input
              name="starting_units_threshold"
              type="number"
              step="1"
              defaultValue={Number(r.starting_units_threshold ?? 0)}
              className="input"
            />
          </div>
          <div>
            <label className="label">Band end</label>
            <input
              name="ending_units_threshold"
              type="number"
              step="1"
              defaultValue={Number(r.ending_units_threshold ?? 25)}
              className="input"
            />
          </div>
        </div>
        <button className="btn-primary w-full text-xs">Save</button>
      </form>
      <form action={deleteScaling}>
        <input type="hidden" name="id" value={r.id} />
        <button className="btn-danger w-full text-xs">Delete row</button>
      </form>
    </div>
  );
}
