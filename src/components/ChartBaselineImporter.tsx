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
  /** Existing points loaded from DB */
  initialPoints: ChartBaselinePoint[];
  /** Optional override for the button label */
  buttonLabel?: string;
}

type Row = { day_number: string; cumulative_units: string };

function toRows(points: ChartBaselinePoint[]): Row[] {
  return [...points]
    .sort((a, b) => a.day_number - b.day_number)
    .map((p) => ({
      day_number: String(p.day_number),
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
    // suggest the next day number based on the highest existing
    const nextDay = rows.reduce((m, r) => {
      const d = Number(r.day_number);
      return Number.isFinite(d) && d > m ? d : m;
    }, 0) + 1;
    setRows((p) => [...p, { day_number: String(nextDay), cumulative_units: "" }]);
  }
  function updateRow(i: number, patch: Partial<Row>) {
    setRows((p) => p.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function removeRow(i: number) {
    setRows((p) => p.filter((_, idx) => idx !== i));
  }
  function pasteCsv(text: string) {
    // Accepts lines of "day,units" or "day\tunits" (e.g. "1, 0.5")
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const parsed: Row[] = [];
    for (const line of lines) {
      const parts = line.split(/[,\t]/).map((s) => s.trim());
      if (parts.length < 2) continue;
      const day = parts[0];
      const units = parts[1];
      if (!/^\d+$/.test(day) || Number(day) < 1) continue;
      if (!Number.isFinite(Number(units))) continue;
      parsed.push({ day_number: day, cumulative_units: units });
    }
    if (parsed.length === 0) {
      setErr("Couldn't parse any rows. Use one per line: betting-day, units");
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

    // Validate: no duplicate day_numbers, all positive
    const seen = new Set<number>();
    for (const r of rows) {
      const d = Math.round(Number(r.day_number));
      if (!r.day_number || r.cumulative_units === "") continue;
      if (!Number.isFinite(d) || d < 1) {
        setErr(`Invalid betting day "${r.day_number}". Must be an integer ≥ 1.`);
        return;
      }
      if (seen.has(d)) {
        setErr(`Duplicate betting day ${d}. Each day can only appear once.`);
        return;
      }
      seen.add(d);
    }

    start(async () => {
      const points = rows
        .filter((r) => r.day_number && r.cumulative_units !== "")
        .map((r) => ({
          day_number: Math.round(Number(r.day_number)),
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
  const sorted = [...initialPoints].sort((a, b) => a.day_number - b.day_number);
  const summary =
    sorted.length === 0
      ? null
      : {
          count: sorted.length,
          firstDay: sorted[0].day_number,
          lastDay: sorted[sorted.length - 1].day_number,
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
                  <span className="text-ink">(betting day #, cumulative units)</span>{" "}
                  — the running total as of that day. Tracked data continues at{" "}
                  <span className="text-ink">Day {(summary?.lastDay ?? 0) + 1}</span>.
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
                  {summary.count} point{summary.count === 1 ? "" : "s"} imported ·
                  Day {summary.firstDay} → Day {summary.lastDay} · ends at{" "}
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
                  CSV (one per line: <code>betting-day, units</code>).
                </p>
              )}

              {rows.map((r, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-5">
                    {idx === 0 && <label className="label">Betting day #</label>}
                    <input
                      type="number"
                      min={1}
                      step={1}
                      className="input"
                      value={r.day_number}
                      placeholder="e.g. 1"
                      onChange={(e) =>
                        updateRow(idx, { day_number: e.target.value })
                      }
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
                    placeholder={"1, 0\n2, 1.5\n3, -0.4\n4, 2.1"}
                    onPaste={(e) => {
                      const text = e.clipboardData.getData("text");
                      if (text && /\d/.test(text)) {
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
