import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadShellContext } from "@/lib/active-system";
import type { JournalDayEntry } from "@/lib/types";
import { fmtMoney, fmtPct, fmtUnits, pctClass } from "@/lib/utils";
import ExportButton from "@/components/ExportButton";

export const dynamic = "force-dynamic";

export default async function JournalPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string };
}) {
  const ctx = await loadShellContext();
  if (!ctx) redirect("/login");
  const sysId = ctx.activeSystemId;
  const supabase = createClient();
  let q = supabase.from("journal_day_entries").select("*").eq("system_id", sysId).order("date", { ascending: false });
  if (searchParams.from) q = q.gte("date", searchParams.from);
  if (searchParams.to) q = q.lte("date", searchParams.to);
  const { data } = await q;
  const rows = (data ?? []) as JournalDayEntry[];

  return (
    <div className="p-6 space-y-6" id="journal-root">
      <header className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[10px] tracking-[0.4em] text-accent uppercase">Journal</div>
          <h1 className="text-2xl font-bold">Daily Betting Journal</h1>
          <p className="text-ink-dim text-sm">
            Auto-synced from all active capper days. Read-only — edit a capper day to update a journal row.
          </p>
        </div>
        <div className="flex gap-2">
          <ExportButton targetId="journal-root" filename="journal.png" />
        </div>
      </header>

      <form className="panel p-4 grid md:grid-cols-4 gap-3 items-end">
        <div>
          <label className="label">From</label>
          <input name="from" type="date" defaultValue={searchParams.from || ""} className="input" />
        </div>
        <div>
          <label className="label">To</label>
          <input name="to" type="date" defaultValue={searchParams.to || ""} className="input" />
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
                  <td colSpan={10} className="text-center text-ink-dim py-6">
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
