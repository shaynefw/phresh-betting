"use client";

import { Plus, Trash2 } from "lucide-react";
import type { BaselineStreakEntry } from "@/lib/types";

interface Props {
  value: BaselineStreakEntry[];
  onChange: (next: BaselineStreakEntry[]) => void;
}

/**
 * Editable list of historical streak entries: each row is
 * (type green/red, length, count). Used inside both baseline forms.
 */
export default function StreakEntriesEditor({ value, onChange }: Props) {
  function update(idx: number, patch: Partial<BaselineStreakEntry>) {
    onChange(value.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  }
  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }
  function add() {
    onChange([...value, { type: "green", length: 1, count: 1 }]);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="kpi-label">Historical streak breakdown</div>
        <button type="button" className="btn-ghost text-xs" onClick={add}>
          <Plus className="h-3.5 w-3.5" /> Add row
        </button>
      </div>
      <p className="text-xs text-ink-dim mb-3">
        Pre-app streak counts. Merged with live tracked streaks on the dashboard and capper pages.
      </p>

      {value.length === 0 ? (
        <p className="text-xs text-ink-dim italic">
          No historical streaks. Click <em>Add row</em> to record one (e.g.{" "}
          <span className="text-ink">3 green : 4</span> means a 3-day green streak that occurred 4 times).
        </p>
      ) : (
        <div className="space-y-2">
          {value.map((e, idx) => (
            <div
              key={idx}
              className="grid grid-cols-12 gap-2 items-end bg-bg-panel/40 border border-border rounded-md p-2"
            >
              <div className="col-span-4">
                <label className="label">Type</label>
                <select
                  className="input"
                  value={e.type}
                  onChange={(ev) =>
                    update(idx, { type: ev.target.value as "green" | "red" })
                  }
                >
                  <option value="green">Green</option>
                  <option value="red">Red</option>
                </select>
              </div>
              <div className="col-span-3">
                <label className="label">Length</label>
                <input
                  className="input"
                  type="number"
                  min={1}
                  value={e.length}
                  onChange={(ev) =>
                    update(idx, { length: Math.max(1, Number(ev.target.value) || 1) })
                  }
                />
              </div>
              <div className="col-span-3">
                <label className="label">Count</label>
                <input
                  className="input"
                  type="number"
                  min={1}
                  value={e.count}
                  onChange={(ev) =>
                    update(idx, { count: Math.max(1, Number(ev.target.value) || 1) })
                  }
                />
              </div>
              <div className="col-span-2 flex justify-end">
                <button
                  type="button"
                  className="btn-danger text-xs"
                  onClick={() => remove(idx)}
                  aria-label="Remove row"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
