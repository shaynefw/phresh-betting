"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { replaceChartBaselinePoints } from "@/app/(app)/_actions";
import type { ChartBaselinePoint } from "@/lib/types";
import { fmtUnits } from "@/lib/utils";
import { Upload, Plus, Trash2, X, Save, History } from "lucide-react";

interface Props {
  systemId: string;
  /** null → system-level points (dashboard chart); set → capper-level */
  capperId: string | null;
  /** Existing points loaded from DB (sorted by date asc) */
  initialPoints: ChartBaselinePoint[];
  /** Optional override for the button label */
  buttonLabel?: string;
}

type Row = { date: string; cumulative_units: string };

function toRows(points: ChartBaselinePoint[]): Row[] {
  return [...points]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((p) => ({
      date: p.date,
      cumulative_units: String(p.cumulative_units),
    }));
}

export default function ChartBaselineImporter({
  systemId,
  capperId,
  initialPoints,
  buttonLabel,
}: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>(() => toRows(initialPoints));
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  function addRow() {
    setRows((p) => [...p, { date: "", cumulative_units: "" }]);
  }
  function updateRow(i: number, patch: Partial<Row>) {
    setRows((p) => p.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function removeRow(i: number) {
    setRows((p) => p.filter((_, idx) => idx !== i));
  }
  function pasteCsv(text: string) {
    // Accepts lines of "YYYY-MM-DD,units" or "YYYY-MM-DD\tunits"
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const parsed: Row[] = [];
    for (const line of lines) {
      const parts = line.split(/[,\t]/).map((s) => s.trim());
      if (parts.length < 2) continue;
      const date = parts[0];
      const units = parts[1];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      if (!Number.isFinite(Number(units))) continue;
      parsed.push({ date, cumulative_units: units });
    }
    if (parsed.length === 0) {
      setErr("Couldn't parse any rows. Use one per line: YYYY-MM-DD, units");
      return;
    }
    setRows((p) => [...p, ...parsed]);
    setErr(null);
    setMsg(`Parsed ${parsed.length} rows.`);
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    start(async () => {
      const points = rows
        .filter((r) => r.date && r.cumulative_units !== "")
        .map((r) => ({
          date: r.date,
          cumulative_units: Number(r.cumulative_units),
        }));
      const res = await replaceChartBaselinePoints({ systemId, capperId, points });
      if (res?.error) {
        setErr(res.error);
        return;
      }
      setMsg(
        points.length === 0
          ? "All baseline points cleared."
          : `Saved ${points.length} baseline point${points.length === 1 ? "" : "s"}.`,
      );
      router.refresh();
      setTimeout(() => setOpen(false), 500);
    });
  }

  // summary for the existing imported points
  const sorted = [...initialPoints].sort((a, b) => (a.date < b.date ? -1 : 1));
  const summary =
    sorted.length === 0
      ? null
      : {
          count: sorted.length,
          first: sorted[0].date,
          last: sorted[sorted.length - 1].date,
          endingUnits: Number(sorted[sorted.length - 1].cumulative_units),
        };

  return (
    <>
      <button
        type="button"
        className="btn-ghost"
        onClick={() => setOpen(true)}
        title="Add historical (pre-app) data points to this chart"
      >
        <Upload className="h-4 w-4" />
        {buttonLabel ?? "Import Baseline Data"}
        {summary && (
          <span className="pill-info text-[10px] ml-1">{summary.count}</span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => !pending && setOpen(false)}
          />
          <div className="relative z-10 w-full max-w-2xl panel p-4 md:p-6 max-h-[90vh] overflow-y-auto rounded-t-2xl md:rounded-xl">
            <div className="flex items-start justify-between mb-3 gap-3">
              <div>
                <div className="text-[10px] tracking-[0.4em] text-accent uppercase">
                  Import Baseline Data
                </div>
                <h2 className="text-lg md:text-xl font-bold">
                  Pre-app cumulative units
                </h2>
                <p className="text-xs text-ink-dim mt-1">
                  Add a row for each historical betting day. Each point is{" "}
                  <span className="text-ink">(date, cumulative units)</span> — the
                  running total as of that day. Points render on the chart
                  before tracked data, with no visual distinction.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => !pending && setOpen(false)}
                className="p-2 rounded-md hover:bg-bg-card shrink-0"
              >
                <X className="h-5 w-5 text-ink" />
              </button>
            </div>

            {summary && (
              <div className="bg-bg-panel/60 rounded-md border border-border px-3 py-2 mb-3 flex items-center gap-2 text-xs">
                <History className="h-3.5 w-3.5 text-accent shrink-0" />
                <span className="text-ink-dim">
                  {summary.count} point{summary.count === 1 ? "" : "s"} imported ·{" "}
                  {summary.first} → {summary.last} · ends at{" "}
                  <span className={summary.endingUnits >= 0 ? "text-good" : "text-bad"}>
                    {fmtUnits(summary.endingUnits)}
                  </span>
                </span>
              </div>
            )}

            <form onSubmit={save} className="space-y-2">
              {rows.length === 0 && (
                <p className="text-xs text-ink-dim italic py-3">
                  No baseline points yet. Click <em>Add row</em> below, or paste
                  CSV (one per line: <code>YYYY-MM-DD, units</code>).
                </p>
              )}

              {rows.map((r, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-5">
                    {idx === 0 && <label className="label">Date</label>}
                    <input
                      type="date"
                      className="input"
                      value={r.date}
                      onChange={(e) => updateRow(idx, { date: e.target.value })}
                    />
                  </div>
                  <div className="col-span-5">
                    {idx === 0 && (
                      <label className="label">Cumulative units</label>
                    )}
                    <input
                      type="number"
                      step="0.0001"
                      className="input"
                      value={r.cumulative_units}
                      placeholder="e.g. 2.5"
                      onChange={(e) =>
                        updateRow(idx, { cumulative_units: e.target.value })
                      }
                    />
                  </div>
                  <div className="col-span-2 flex justify-end">
                    <button
                      type="button"
                      className="btn-danger text-xs"
                      onClick={() => removeRow(idx)}
                      aria-label="Remove row"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button type="button" className="btn-ghost text-xs" onClick={addRow}>
                  <Plus className="h-3.5 w-3.5" /> Add row
                </button>
                <details className="text-xs text-ink-dim">
                  <summary className="cursor-pointer hover:text-ink">
                    …or paste CSV
                  </summary>
                  <textarea
                    className="input min-h-[80px] font-mono text-[11px] mt-2 w-full"
                    placeholder={"2025-01-01, 0\n2025-01-02, 1.5\n2025-01-03, -0.4"}
                    onPaste={(e) => {
                      const text = e.clipboardData.getData("text");
                      if (text && /\d{4}-\d{2}-\d{2}/.test(text)) {
                        e.preventDefault();
                        pasteCsv(text);
                      }
                    }}
                  />
                </details>
              </div>

              {err && <p className="text-bad text-sm">{err}</p>}
              {msg && <p className="text-accent text-sm">{msg}</p>}

              <div className="flex flex-wrap gap-2 justify-end pt-3 border-t border-border">
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => !pending && setOpen(false)}
                  disabled={pending}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={pending}>
                  <Save className="h-4 w-4" />
                  {pending ? "Saving..." : "Save baseline points"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
