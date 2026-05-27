import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadShellContext } from "@/lib/active-system";
import type { JournalBaselineDay, JournalDayEntry } from "@/lib/types";
import { fmtMoney, fmtPct, fmtUnits, fmtWinLoss, pctClass } from "@/lib/utils";
import ExportButton from "@/components/ExportButton";
import JournalBaselineForm from "@/components/JournalBaselineForm";

export const dynamic = "force-dynamic";

export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await loadShellContext();
  if (!ctx) redirect("/sign-in");
  const sysId = ctx.activeSystemId;
  const supabase = createAdminClient();
  let q = supabase.from("journal_day_entries").select("*").eq("system_id", sysId).order("date", { ascending: false });
  if (sp.from) q = q.gte("date", sp.from);
  if (sp.to) q = q.lte("date", sp.to);
  // Fetch baseline rows in parallel so the importer can show its
  // current count + power the Clear button.
  const [{ data }, { data: baseline }] = await Promise.all([
    q,
    supabase
      .from("journal_baseline_days")
      .select("*")
      .eq("system_id", sysId)
      .order("date"),
  ]);
  const rows = (data ?? []) as JournalDayEntry[];
  const baselineRows = (baseline ?? []) as JournalBaselineDay[];

  return (
    <div className="p-3 md:p-6 space-y-4 md:space-y-6" id="journal-root">
      <header className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[10px] tracking-[0.4em] text-accent uppercase">Journal</div>
          <h1 className="text-2xl font-bold">Daily Betting Journal</h1>
          <p className="text-ink-dim text-sm">
            Auto-synced from all active capper days. Read-only — edit a capper day to update a journal row.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <JournalBaselineForm systemId={sysId} initialRows={baselineRows} />
          <ExportButton targetId="journal-root" filename="journal.png" />
        </div>
      </header>

      <form className="panel p-4 grid md:grid-cols-4 gap-3 items-end">
        <div>
          <label className="label">From</label>
          <input name="from" type="date" defaultValue={sp.from || ""} className="input" />
        </div>
        <div>
          <label className="label">To</label>
          <input name="to" type="date" defaultValue={sp.to || ""} className="input" />
        </div>
        <div>
          <button className="btn-primary">Filter</button>
        </div>
      </form>

      <div className="panel p-0">
        <div className="table-wrap">
          <table className="tbl font-mono">
            <thead>
              <tr>
                <th>Date</th>
                <th className="text-right">Bets</th>
                <th className="text-right">Wager</th>
                <th className="text-right">Daily $ PnL</th>
                <th className="text-right">Daily Units</th>
                <th className="text-right">Daily ROI</th>
                <th className="text-right">Win Rate</th>
                <th className="text-right">Cum $</th>
                <th className="text-right">Cum Units</th>
                <th className="text-right">Run ROI</th>
                <th className="text-right">Streak</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.date}</td>
                  <td className="text-right">{r.total_bets}</td>
                  <td className="text-right">{fmtMoney(r.total_wager)}</td>
                  <td className={`text-right ${pctClass(r.daily_amount_pnl)}`}>
                    {fmtMoney(r.daily_amount_pnl, { sign: true })}
                  </td>
                  <td className={`text-right ${pctClass(r.daily_units_pnl)}`}>
                    {fmtUnits(r.daily_units_pnl)}
                  </td>
                  <td className={`text-right ${pctClass(r.daily_roi_percent)}`}>
                    {fmtPct(r.daily_roi_percent)}
                  </td>
                  <td
                    className={`text-right ${pctClass(
                      Number(r.wins ?? 0) - Number(r.losses ?? 0),
                    )}`}
                  >
                    {fmtWinLoss(Number(r.wins ?? 0), Number(r.losses ?? 0))}
                  </td>
                  <td className={`text-right ${pctClass(r.cumulative_amount_pnl)}`}>
                    {fmtMoney(r.cumulative_amount_pnl, { sign: true })}
                  </td>
                  <td className={`text-right ${pctClass(r.cumulative_units_pnl)}`}>
                    {fmtUnits(r.cumulative_units_pnl)}
                  </td>
                  <td className={`text-right ${pctClass(r.running_roi_percent)}`}>
                    {fmtPct(r.running_roi_percent)}
                  </td>
                  <td className={`text-right ${
                    r.current_streak_type === "green"
                      ? "text-good"
                      : r.current_streak_type === "red"
                      ? "text-bad"
                      : "text-ink-dim"
                  }`}>
                    {r.current_streak_type === "neutral_hold"
                      ? "—"
                      : `${r.current_streak_type === "green" ? "+" : "-"}${r.current_streak_value}`}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={11} className="text-center text-ink-dim py-6">
                    No journal entries yet.
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
