"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upsertCapperBaseline, clearCapperBaseline } from "../../_actions";
import type { BaselineStreakEntry, CapperBaseline } from "@/lib/types";
import { X, Save, Trash2, Sliders } from "lucide-react";
import { fmtMoney, fmtPct, fmtUnits } from "@/lib/utils";
import StreakEntriesEditor from "@/components/StreakEntriesEditor";

interface Props {
  capperId: string;
  systemId: string;
  baseline: CapperBaseline | null;
}

type FormState = {
  total_betting_days: string;
  total_bets: string;
  total_risk: string;
  cumulative_amount_pnl: string;
  cumulative_units_pnl: string;
  wins: string;
  losses: string;
  green_day_count: string;
  red_day_count: string;
  green_day_roi_cumulative: string;
  red_day_roi_cumulative: string;
  running_roi_percent: string;
  win_rate_percent: string;
  green_day_avg_roi: string;
  red_day_avg_roi: string;
  green_day_probability: string;
  current_streak_value: string;
  current_streak_type: "green" | "red" | "neutral_hold";
  max_win_streak: string;
  max_loss_streak: string;
  notes: string;
};

function s(v: number | null | undefined): string {
  if (v == null) return "";
  return String(v);
}

function init(b: CapperBaseline | null): FormState {
  return {
    total_betting_days: s(b?.total_betting_days ?? 0),
    total_bets: s(b?.total_bets ?? 0),
    total_risk: s(b?.total_risk ?? 0),
    cumulative_amount_pnl: s(b?.cumulative_amount_pnl ?? 0),
    cumulative_units_pnl: s(b?.cumulative_units_pnl ?? 0),
    wins: s(b?.wins ?? 0),
    losses: s(b?.losses ?? 0),
    green_day_count: s(b?.green_day_count ?? 0),
    red_day_count: s(b?.red_day_count ?? 0),
    green_day_roi_cumulative: s(b?.green_day_roi_cumulative ?? 0),
    red_day_roi_cumulative: s(b?.red_day_roi_cumulative ?? 0),
    running_roi_percent: s(b?.running_roi_percent ?? 0),
    win_rate_percent: s(b?.win_rate_percent ?? 0),
    green_day_avg_roi: s(b?.green_day_avg_roi ?? 0),
    red_day_avg_roi: s(b?.red_day_avg_roi ?? 0),
    green_day_probability: s(b?.green_day_probability ?? 0),
    current_streak_value: s(b?.current_streak_value ?? 0),
    current_streak_type: b?.current_streak_type ?? "neutral_hold",
    max_win_streak: s(b?.max_win_streak ?? 0),
    max_loss_streak: s(b?.max_loss_streak ?? 0),
    notes: b?.notes ?? "",
  };
}

export default function BaselineForm({ capperId, systemId, baseline }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(() => init(baseline));
  const [streaks, setStreaks] = useState<BaselineStreakEntry[]>(
    baseline?.streak_breakdown ?? [],
  );
  const [err, setErr] = useState<string | null>(null);

  function autoDerive() {
    // Convenience: fill in ratios from totals
    const tr = Number(form.total_risk || 0);
    const cum = Number(form.cumulative_amount_pnl || 0);
    const w = Number(form.wins || 0);
    const l = Number(form.losses || 0);
    const gd = Number(form.green_day_count || 0);
    const rd = Number(form.red_day_count || 0);
    const grC = Number(form.green_day_roi_cumulative || 0);
    const rrC = Number(form.red_day_roi_cumulative || 0);
    setForm((p) => ({
      ...p,
      running_roi_percent: tr === 0 ? "0" : ((cum / tr) * 100).toFixed(4),
      win_rate_percent: w + l === 0 ? "0" : ((w / (w + l)) * 100).toFixed(4),
      green_day_avg_roi: gd === 0 ? "0" : (grC / gd).toFixed(4),
      red_day_avg_roi: rd === 0 ? "0" : (rrC / rd).toFixed(4),
      green_day_probability:
        gd + rd === 0 ? "0" : ((gd / (gd + rd)) * 100).toFixed(4),
    }));
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    start(async () => {
      const res = await upsertCapperBaseline({
        capperId,
        systemId,
        total_betting_days: Math.round(Number(form.total_betting_days || 0)),
        total_bets: Math.round(Number(form.total_bets || 0)),
        total_risk: Number(form.total_risk || 0),
        cumulative_amount_pnl: Number(form.cumulative_amount_pnl || 0),
        cumulative_units_pnl: Number(form.cumulative_units_pnl || 0),
        wins: Math.round(Number(form.wins || 0)),
        losses: Math.round(Number(form.losses || 0)),
        green_day_count: Math.round(Number(form.green_day_count || 0)),
        red_day_count: Math.round(Number(form.red_day_count || 0)),
        green_day_roi_cumulative: Number(form.green_day_roi_cumulative || 0),
        red_day_roi_cumulative: Number(form.red_day_roi_cumulative || 0),
        running_roi_percent: Number(form.running_roi_percent || 0),
        win_rate_percent: Number(form.win_rate_percent || 0),
        green_day_avg_roi: Number(form.green_day_avg_roi || 0),
        red_day_avg_roi: Number(form.red_day_avg_roi || 0),
        green_day_probability: Number(form.green_day_probability || 0),
        current_streak_value: Math.round(Number(form.current_streak_value || 0)),
        current_streak_type: form.current_streak_type,
        max_win_streak: Math.round(Number(form.max_win_streak || 0)),
        max_loss_streak: Math.round(Number(form.max_loss_streak || 0)),
        streak_breakdown: streaks
          .filter((e) => e.length > 0 && e.count > 0)
          .map((e) => ({
            type: e.type,
            length: Math.round(Number(e.length)),
            count: Math.round(Number(e.count)),
          })),
        notes: form.notes || null,
      });
      if (res?.error) {
        setErr(res.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  function clear() {
    if (!confirm("Remove this capper's historical baseline? Tracked data is unaffected.")) return;
    start(async () => {
      await clearCapperBaseline(capperId, systemId);
      setForm(init(null));
      setStreaks([]);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        className="btn-ghost"
        onClick={() => setOpen(true)}
      >
        <Sliders className="h-4 w-4" />
        {baseline ? "Edit baseline" : "Set historical baseline"}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => !pending && setOpen(false)}
          />
          <div className="relative z-10 w-full max-w-3xl panel p-4 md:p-6 max-h-[90vh] overflow-y-auto rounded-t-2xl md:rounded-xl">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-[10px] tracking-[0.4em] text-accent uppercase">
                  Historical baseline
                </div>
                <h2 className="text-lg md:text-xl font-bold">
                  Manual starting metrics
                </h2>
                <p className="text-xs text-ink-dim mt-1">
                  Pre-app totals for this capper. Live tracked data adds on top of these values.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => !pending && setOpen(false)}
                className="p-2 rounded-md hover:bg-bg-card"
              >
                <X className="h-5 w-5 text-ink" />
              </button>
            </div>

            <form onSubmit={save} className="space-y-4">
              <Section title="Counters">
                <Input label="Total betting days" v={form.total_betting_days}
                  on={(x) => setForm((p) => ({ ...p, total_betting_days: x }))} />
                <Input label="Total bets" v={form.total_bets}
                  on={(x) => setForm((p) => ({ ...p, total_bets: x }))} />
                <Input label="Total risk ($)" step="0.01" v={form.total_risk}
                  on={(x) => setForm((p) => ({ ...p, total_risk: x }))} />
                <Input label="Cumulative $ profit" step="0.01" v={form.cumulative_amount_pnl}
                  on={(x) => setForm((p) => ({ ...p, cumulative_amount_pnl: x }))} />
                <Input label="Cumulative units" step="0.0001" v={form.cumulative_units_pnl}
                  on={(x) => setForm((p) => ({ ...p, cumulative_units_pnl: x }))} />
                <Input label="Wins" v={form.wins}
                  on={(x) => setForm((p) => ({ ...p, wins: x }))} />
                <Input label="Losses" v={form.losses}
                  on={(x) => setForm((p) => ({ ...p, losses: x }))} />
              </Section>

              <Section title="Day breakdown">
                <Input label="Green days" v={form.green_day_count}
                  on={(x) => setForm((p) => ({ ...p, green_day_count: x }))} />
                <Input label="Red days" v={form.red_day_count}
                  on={(x) => setForm((p) => ({ ...p, red_day_count: x }))} />
                <Input label="Green day ROI cumulative (%)" step="0.0001" v={form.green_day_roi_cumulative}
                  on={(x) => setForm((p) => ({ ...p, green_day_roi_cumulative: x }))} />
                <Input label="Red day ROI cumulative (%)" step="0.0001" v={form.red_day_roi_cumulative}
                  on={(x) => setForm((p) => ({ ...p, red_day_roi_cumulative: x }))} />
              </Section>

              <Section title="Computed metrics" right={
                <button type="button" className="btn-ghost text-xs" onClick={autoDerive}>
                  Auto-derive from totals
                </button>
              }>
                <Input label="Running ROI (%)" step="0.0001" v={form.running_roi_percent}
                  on={(x) => setForm((p) => ({ ...p, running_roi_percent: x }))} />
                <Input label="Win rate (%)" step="0.0001" v={form.win_rate_percent}
                  on={(x) => setForm((p) => ({ ...p, win_rate_percent: x }))} />
                <Input label="Green day avg ROI (%)" step="0.0001" v={form.green_day_avg_roi}
                  on={(x) => setForm((p) => ({ ...p, green_day_avg_roi: x }))} />
                <Input label="Red day avg ROI (%)" step="0.0001" v={form.red_day_avg_roi}
                  on={(x) => setForm((p) => ({ ...p, red_day_avg_roi: x }))} />
                <Input label="Green day probability (%)" step="0.0001" v={form.green_day_probability}
                  on={(x) => setForm((p) => ({ ...p, green_day_probability: x }))} />
              </Section>

              <Section title="Streaks">
                <div>
                  <label className="label">Current streak type</label>
                  <select
                    className="input"
                    value={form.current_streak_type}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        current_streak_type: e.target.value as FormState["current_streak_type"],
                      }))
                    }
                  >
                    <option value="green">Green</option>
                    <option value="red">Red</option>
                    <option value="neutral_hold">Neutral / hold</option>
                  </select>
                </div>
                <Input label="Current streak value" v={form.current_streak_value}
                  on={(x) => setForm((p) => ({ ...p, current_streak_value: x }))} />
                <Input label="Max win streak" v={form.max_win_streak}
                  on={(x) => setForm((p) => ({ ...p, max_win_streak: x }))} />
                <Input label="Max loss streak" v={form.max_loss_streak}
                  on={(x) => setForm((p) => ({ ...p, max_loss_streak: x }))} />
              </Section>

              <StreakEntriesEditor value={streaks} onChange={setStreaks} />

              <div>
                <label className="label">Notes</label>
                <textarea
                  className="input min-h-[60px]"
                  value={form.notes}
                  onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                  placeholder="Optional — what date range these numbers cover, source, etc."
                />
              </div>

              {/* preview totals */}
              {(Number(form.cumulative_units_pnl) !== 0 ||
                Number(form.cumulative_amount_pnl) !== 0 ||
                Number(form.total_betting_days) !== 0) && (
                <div className="text-xs text-ink-dim border border-border rounded-md p-3 bg-bg-panel/50">
                  Baseline preview: <span className="font-mono text-ink">{Number(form.total_betting_days)}</span> days · <span className="font-mono text-ink">{Number(form.total_bets)}</span> bets · <span className="font-mono">{fmtUnits(Number(form.cumulative_units_pnl))}</span> · <span className="font-mono">{fmtMoney(Number(form.cumulative_amount_pnl), { sign: true })}</span> · ROI <span className="font-mono">{fmtPct(Number(form.running_roi_percent))}</span>
                </div>
              )}

              {err && <p className="text-bad text-sm">{err}</p>}

              <div className="flex flex-wrap gap-2 justify-between sticky bottom-0 bg-bg-card pt-3 -mx-4 md:-mx-6 px-4 md:px-6 border-t border-border">
                {baseline ? (
                  <button type="button" className="btn-danger" onClick={clear} disabled={pending}>
                    <Trash2 className="h-4 w-4" /> Remove baseline
                  </button>
                ) : <span />}
                <div className="flex gap-2">
                  <button type="button" className="btn-ghost" onClick={() => setOpen(false)} disabled={pending}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary" disabled={pending}>
                    <Save className="h-4 w-4" />
                    {pending ? "Saving..." : "Save baseline"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function Section({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="kpi-label">{title}</div>
        {right}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">{children}</div>
    </div>
  );
}

function Input({
  label,
  v,
  on,
  step = "1",
}: {
  label: string;
  v: string;
  on: (v: string) => void;
  step?: string;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        className="input"
        type="number"
        step={step}
        value={v}
        onChange={(e) => on(e.target.value)}
      />
    </div>
  );
}
