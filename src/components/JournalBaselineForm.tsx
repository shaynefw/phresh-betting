"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { History, Trash2, Save, X, Pencil, Plus } from "lucide-react";
import {
  clearJournalBaseline,
  deleteJournalBaselineDay,
  upsertJournalBaselineDay,
} from "@/app/(app)/_actions";
import type { JournalBaselineDay } from "@/lib/types";
import { fmtMoney, fmtPct, fmtUnits, fmtWinLoss, pctClass } from "@/lib/utils";

/**
 * Manual entry form for Daily Betting Journal baseline rows.
 *
 * Replaces the prior file-upload importer per the corrected spec.
 * Each submission upserts one baseline row by (system_id, date); the
 * DB trigger fires recompute_journal once so the journal page's
 * cumulative columns (Cum $, Cum Units, Run ROI, Streak) rebuild
 * automatically before the page refresh completes.
 *
 * Inputs collected:
 *   - Date
 *   - Bets
 *   - Wager
 *   - Daily $ PnL    ← independent dollar tracking
 *   - Daily Units   ← independent unit tracking (NOT derived from $ PnL)
 *   - Wins / Losses
 *
 * Auto-displayed (read-only, live-derived from the inputs above):
 *   - Daily ROI  = pnl / wager × 100
 *   - Win Rate   = W-L (pct%)
 *
 * Cum $ accumulates from Daily $ PnL; Cum Units accumulates from
 * Daily Units. They're stored as independent fields and never
 * back-derive from each other — the recompute_journal SQL sums them
 * separately by date.
 *
 * Below the form, a list of every baseline row already in the system
 * shows next to a per-row Edit + Delete button. Clicking Edit
 * pre-fills the form with that row's values so the next submit
 * upserts that date in place. Bulk Clear is retained.
 */

interface Props {
  systemId: string;
  initialRows: JournalBaselineDay[];
}

interface FormState {
  date: string;
  bets: string;
  wager: string;
  pnl: string;
  units: string;
  wins: string;
  losses: string;
}

function emptyForm(): FormState {
  return {
    date: "",
    bets: "",
    wager: "",
    pnl: "",
    units: "",
    wins: "",
    losses: "",
  };
}

function fromRow(r: JournalBaselineDay): FormState {
  return {
    date: r.date,
    bets: String(r.total_bets ?? 0),
    wager: String(r.total_wager ?? 0),
    pnl: String(r.daily_amount_pnl ?? 0),
    units: String(r.daily_units_pnl ?? 0),
    wins: String(r.wins ?? 0),
    losses: String(r.losses ?? 0),
  };
}

export default function JournalBaselineForm({ systemId, initialRows }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Live-derived previews — recompute on every keystroke.
  const wagerNum = Number(form.wager || 0);
  const pnlNum = Number(form.pnl || 0);
  const winsNum = Math.max(0, Math.round(Number(form.wins || 0)));
  const lossesNum = Math.max(0, Math.round(Number(form.losses || 0)));
  const dailyRoiPreview =
    wagerNum > 0 && Number.isFinite(pnlNum) ? (pnlNum / wagerNum) * 100 : 0;
  const winRatePreview = fmtWinLoss(winsNum, lossesNum);

  function reset() {
    setForm(emptyForm());
    setEditingDate(null);
    setErr(null);
  }

  function startEdit(r: JournalBaselineDay) {
    setForm(fromRow(r));
    setEditingDate(r.date);
    setErr(null);
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) {
      setErr("Date is required (YYYY-MM-DD).");
      return;
    }
    start(async () => {
      const res = await upsertJournalBaselineDay({
        systemId,
        date: form.date,
        total_bets: Math.round(Number(form.bets || 0)),
        total_wager: Number(form.wager || 0),
        daily_amount_pnl: Number(form.pnl || 0),
        // Independent unit input — Cum Units accumulates from this
        // field directly, not from Daily $ PnL.
        daily_units_pnl: Number(form.units || 0),
        wins: winsNum,
        losses: lossesNum,
      });
      if ("error" in res && res.error) {
        setErr(res.error);
        return;
      }
      reset();
      router.refresh();
    });
  }

  function onDelete(date: string) {
    if (!confirm(`Remove baseline row for ${date}?`)) return;
    start(async () => {
      await deleteJournalBaselineDay({ systemId, date });
      if (editingDate === date) reset();
      router.refresh();
    });
  }

  function onClearAll() {
    if (
      !confirm(
        `Remove ALL ${initialRows.length} baseline row${
          initialRows.length === 1 ? "" : "s"
        }? The Daily Betting Journal will recompute from tracked data only.`,
      )
    )
      return;
    start(async () => {
      await clearJournalBaseline(systemId);
      reset();
      router.refresh();
    });
  }

  const count = initialRows.length;
  // Latest-first inside the modal so the most recent baseline rows
  // (closest to the tracked period) are visible without scrolling.
  const sortedRows = [...initialRows].sort((a, b) =>
    b.date.localeCompare(a.date),
  );

  return (
    <>
      <button
        type="button"
        className={`btn-ghost text-xs ${
          count > 0 ? "border-accent/40 text-accent" : ""
        }`}
        onClick={() => setOpen(true)}
        title={
          count > 0
            ? `${count} baseline day${count === 1 ? "" : "s"} on file`
            : "Add historical baseline rows"
        }
      >
        <History className="h-3.5 w-3.5" />
        Baseline {count > 0 ? `(${count})` : ""}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => !pending && setOpen(false)}
          />
          <div className="relative z-10 w-full max-w-3xl panel p-4 md:p-6 max-h-[92vh] overflow-y-auto rounded-t-2xl md:rounded-xl">
            <div className="flex items-start justify-between mb-3 gap-3">
              <div>
                <div className="text-[10px] tracking-[0.4em] text-accent uppercase">
                  Journal
                </div>
                <h2 className="text-lg md:text-xl font-bold">
                  Daily Betting Journal — Baseline Entry
                </h2>
                <p className="text-xs text-ink-dim mt-1">
                  Enter one historical day at a time. Every cumulative column
                  on the Journal (Cum $, Cum Units, Run ROI, Streak) will
                  recalculate from the earliest baseline date forward the
                  moment you submit.
                </p>
              </div>
              <button
                type="button"
                onClick={() => !pending && setOpen(false)}
                className="p-2 rounded-md hover:bg-bg-card"
                aria-label="Close"
              >
                <X className="h-5 w-5 text-ink" />
              </button>
            </div>

            {/* ---- Manual entry form ---- */}
            <form
              onSubmit={submit}
              className="panel border-accent/20 bg-bg-panel/50 p-4 space-y-3"
            >
              <div className="grid md:grid-cols-3 gap-3">
                <div>
                  <label className="label">Date</label>
                  <input
                    type="date"
                    className="input"
                    value={form.date}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, date: e.target.value }))
                    }
                    required
                    // Editing locks the date so we don't accidentally
                    // move the row to a different date on save (the user
                    // can delete + re-add if they truly want to move it).
                    disabled={!!editingDate}
                  />
                </div>
                <div>
                  <label className="label">Bets</label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    className="input"
                    value={form.bets}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, bets: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className="label">Wager ($)</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="input"
                    value={form.wager}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, wager: e.target.value }))
                    }
                  />
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <label className="label">Daily $ PNL</label>
                  <input
                    type="number"
                    step="0.01"
                    className="input"
                    value={form.pnl}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, pnl: e.target.value }))
                    }
                  />
                </div>
                <div>
                  {/* Daily Units is a SEPARATE manual input — Cum Units
                      on the Journal accumulates from this column only,
                      not from Daily $ PnL. */}
                  <label className="label">Daily Units</label>
                  <input
                    type="number"
                    step="0.0001"
                    className="input"
                    value={form.units}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, units: e.target.value }))
                    }
                  />
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <label className="label">Daily ROI</label>
                  {/* Read-only derived value — labelled as a real form
                      field so the user sees the metric they listed in
                      the spec, but computed from Wager + $ PnL above. */}
                  <div
                    className={`input flex items-center justify-end font-mono ${pctClass(
                      dailyRoiPreview,
                    )}`}
                  >
                    {wagerNum > 0 ? fmtPct(dailyRoiPreview) : "—"}
                  </div>
                </div>
                <div>
                  <label className="label">Win Rate</label>
                  <div
                    className={`input flex items-center justify-end font-mono ${pctClass(
                      winsNum - lossesNum,
                    )}`}
                  >
                    {winRatePreview}
                  </div>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <label className="label">Wins</label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    className="input"
                    value={form.wins}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, wins: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className="label">Losses</label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    className="input"
                    value={form.losses}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, losses: e.target.value }))
                    }
                  />
                </div>
              </div>

              {err && <p className="text-bad text-sm">{err}</p>}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="submit"
                  className="btn-primary text-xs"
                  disabled={pending}
                >
                  {editingDate ? (
                    <>
                      <Save className="h-3.5 w-3.5" />
                      {pending ? "Saving…" : "Update baseline day"}
                    </>
                  ) : (
                    <>
                      <Plus className="h-3.5 w-3.5" />
                      {pending ? "Saving…" : "Add baseline day"}
                    </>
                  )}
                </button>
                {editingDate && (
                  <button
                    type="button"
                    className="btn-ghost text-xs"
                    onClick={reset}
                    disabled={pending}
                  >
                    Cancel edit
                  </button>
                )}
                {count > 0 && !editingDate && (
                  <button
                    type="button"
                    className="btn-danger text-xs ml-auto"
                    onClick={onClearAll}
                    disabled={pending}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Clear all ({count})
                  </button>
                )}
              </div>
            </form>

            {/* ---- Existing baseline rows ---- */}
            {sortedRows.length > 0 ? (
              <div className="mt-5">
                <div className="kpi-label mb-2">
                  Baseline rows on file ({sortedRows.length})
                </div>
                <div className="table-wrap text-xs">
                  <table className="tbl font-mono">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th className="text-right">Bets</th>
                        <th className="text-right">Wager</th>
                        <th className="text-right">$ PNL</th>
                        <th className="text-right">Units</th>
                        <th className="text-right">ROI</th>
                        <th className="text-right">W-L</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedRows.map((r) => {
                        const isEditing = editingDate === r.date;
                        const roi =
                          r.total_wager > 0
                            ? (r.daily_amount_pnl / r.total_wager) * 100
                            : 0;
                        return (
                          <tr
                            key={r.date}
                            className={isEditing ? "bg-accent/5" : ""}
                          >
                            <td>{r.date}</td>
                            <td className="text-right">{r.total_bets}</td>
                            <td className="text-right">
                              {fmtMoney(r.total_wager)}
                            </td>
                            <td
                              className={`text-right ${pctClass(r.daily_amount_pnl)}`}
                            >
                              {fmtMoney(r.daily_amount_pnl, { sign: true })}
                            </td>
                            <td
                              className={`text-right ${pctClass(r.daily_units_pnl)}`}
                            >
                              {fmtUnits(r.daily_units_pnl)}
                            </td>
                            <td className={`text-right ${pctClass(roi)}`}>
                              {r.total_wager > 0 ? fmtPct(roi) : "—"}
                            </td>
                            <td className="text-right">
                              {fmtWinLoss(r.wins, r.losses)}
                            </td>
                            <td className="text-right">
                              <div className="flex justify-end gap-1">
                                <button
                                  type="button"
                                  className="btn-edit text-xs"
                                  onClick={() => startEdit(r)}
                                  disabled={pending}
                                  title="Edit this baseline row"
                                  aria-label="Edit baseline row"
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                                <button
                                  type="button"
                                  className="btn-danger text-xs"
                                  onClick={() => onDelete(r.date)}
                                  disabled={pending}
                                  title="Delete this baseline row"
                                  aria-label="Delete baseline row"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className="text-xs text-ink-dim italic mt-4">
                No baseline rows yet. Add your first one above.
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
