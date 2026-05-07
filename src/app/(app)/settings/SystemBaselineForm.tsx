"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upsertSystemBaseline, clearSystemBaseline } from "../_actions";
import type { BaselineStreakEntry, CapperBaseline, SystemBaseline } from "@/lib/types";
import { Save, Trash2 } from "lucide-react";
import { fmtMoney, fmtPct, fmtUnits } from "@/lib/utils";
import StreakEntriesEditor from "@/components/StreakEntriesEditor";

interface Props {
  systemId: string;
  systemBaseline: SystemBaseline | null;
  capperBaselines: CapperBaseline[];
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
  max_win_streak: string;
  max_loss_streak: string;
  notes: string;
};

function s(v: number | null | undefined): string {
  if (v == null) return "";
  return String(v);
}

function init(b: SystemBaseline | null): FormState {
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
    max_win_streak: s(b?.max_win_streak ?? 0),
    max_loss_streak: s(b?.max_loss_streak ?? 0),
    notes: b?.notes ?? "",
  };
}

export default function SystemBaselineForm({
  systemId,
  systemBaseline,
  capperBaselines,
}: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [form, setForm] = useState<FormState>(() => init(systemBaseline));
  const [streaks, setStreaks] = useState<BaselineStreakEntry[]>(
    systemBaseline?.streak_breakdown ?? [],
  );
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  /** Sum of all capper baselines — what's already covered. */
  const capperAgg = useMemo(() => {
    const num = (v: unknown) => Number((v ?? 0) as number);
    // effective green/red ROI cumulative: prefer cumulative, fallback to avg*count
    const eGreenCum = (r: typeof capperBaselines[number]) => {
      const cum = num(r.green_day_roi_cumulative);
      return cum !== 0 ? cum : num(r.green_day_avg_roi) * num(r.green_day_count);
    };
    const eRedCum = (r: typeof capperBaselines[number]) => {
      const cum = num(r.red_day_roi_cumulative);
      return cum !== 0 ? cum : num(r.red_day_avg_roi) * num(r.red_day_count);
    };
    return {
      days: capperBaselines.reduce((s, r) => s + num(r.total_betting_days), 0),
      bets: capperBaselines.reduce((s, r) => s + num(r.total_bets), 0),
      risk: capperBaselines.reduce((s, r) => s + num(r.total_risk), 0),
      amount: capperBaselines.reduce((s, r) => s + num(r.cumulative_amount_pnl), 0),
      units: capperBaselines.reduce((s, r) => s + num(r.cumulative_units_pnl), 0),
      wins: capperBaselines.reduce((s, r) => s + num(r.wins), 0),
      losses: capperBaselines.reduce((s, r) => s + num(r.losses), 0),
      green: capperBaselines.reduce((s, r) => s + num(r.green_day_count), 0),
      red: capperBaselines.reduce((s, r) => s + num(r.red_day_count), 0),
      greenRoiCum: capperBaselines.reduce((s, r) => s + eGreenCum(r), 0),
      redRoiCum: capperBaselines.reduce((s, r) => s + eRedCum(r), 0),
    };
  }, [capperBaselines]);

  /** Live preview: what the dashboard will show after saving. */
  const combined = useMemo(() => {
    // Per-user request: green/red ROI cumulative and avg ROI on the
    // dashboard are isolated from capper baselines — only the system
    // baseline contributes from the baseline side. Use form values
    // alone (no capperAgg) for these specific metrics.
    const offsetGreenRoi =
      Number(form.green_day_roi_cumulative || 0) !== 0
        ? Number(form.green_day_roi_cumulative || 0)
        : Number(form.green_day_avg_roi || 0) * Number(form.green_day_count || 0);
    const offsetRedRoi =
      Number(form.red_day_roi_cumulative || 0) !== 0
        ? Number(form.red_day_roi_cumulative || 0)
        : Number(form.red_day_avg_roi || 0) * Number(form.red_day_count || 0);
    // Counts (incl. green/red day count) keep capper-baseline contribution.
    const green = capperAgg.green + Number(form.green_day_count || 0);
    const red = capperAgg.red + Number(form.red_day_count || 0);
    const wins = capperAgg.wins + Number(form.wins || 0);
    const losses = capperAgg.losses + Number(form.losses || 0);
    // Isolated denominators for the avg-ROI calc: system baseline only
    const sysGreen = Number(form.green_day_count || 0);
    const sysRed = Number(form.red_day_count || 0);
    return {
      days: capperAgg.days + Number(form.total_betting_days || 0),
      bets: capperAgg.bets + Number(form.total_bets || 0),
      risk: capperAgg.risk + Number(form.total_risk || 0),
      amount: capperAgg.amount + Number(form.cumulative_amount_pnl || 0),
      units: capperAgg.units + Number(form.cumulative_units_pnl || 0),
      wins,
      losses,
      green,
      red,
      // Isolated: system-baseline side only (journal adds on after save)
      greenRoiCum: offsetGreenRoi,
      redRoiCum: offsetRedRoi,
      greenAvgRoi: sysGreen === 0 ? 0 : offsetGreenRoi / sysGreen,
      redAvgRoi: sysRed === 0 ? 0 : offsetRedRoi / sysRed,
      greenProb: green + red === 0 ? 0 : (green / (green + red)) * 100,
    };
  }, [capperAgg, form]);

  function autoDerive() {
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
    setMsg(null);
    start(async () => {
      const res = await upsertSystemBaseline({
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
      setMsg("System baseline saved.");
      router.refresh();
    });
  }

  function clear() {
    if (
      !confirm(
        "Remove the system-level historical baseline? Capper baselines and tracked data are unaffected.",
      )
    )
      return;
    start(async () => {
      await clearSystemBaseline(systemId);
      setForm(init(null));
      setStreaks([]);
      setMsg("System baseline cleared.");
      router.refresh();
    });
  }

  return (
    <div className="panel p-3 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <div className="text-[10px] tracking-[0.4em] text-accent uppercase">
            Historical Baseline
          </div>
          <h2 className="text-lg md:text-xl font-bold">System-level offset</h2>
          <p className="text-xs text-ink-dim mt-1 max-w-prose">
            Pre-app totals that aren't covered by any current capper's baseline —
            e.g. paper history from cappers you no longer track. The dashboard
            adds this on top of capper baselines and live tracked data.
          </p>
        </div>
        {systemBaseline && (
          <span className="pill-info">baseline saved</span>
        )}
      </div>

      {/* what's already covered + live preview */}
      <div className="grid md:grid-cols-2 gap-3 mb-4">
        <div className="bg-bg-panel/60 rounded-md p-3">
          <div className="kpi-label text-[10px] mb-2">
            Already covered by capper baselines
          </div>
          <div className="grid grid-cols-2 gap-y-1 text-xs font-mono">
            <Cov label="Days" v={capperAgg.days} />
            <Cov label="Bets" v={capperAgg.bets} />
            <Cov label="$ Profit" v={fmtMoney(capperAgg.amount, { sign: true })} tone={capperAgg.amount} />
            <Cov label="Units" v={fmtUnits(capperAgg.units)} tone={capperAgg.units} />
            <Cov label="Total Risk" v={fmtMoney(capperAgg.risk)} />
            <Cov label="W / L" v={`${capperAgg.wins}-${capperAgg.losses}`} />
            <Cov label="Green Days" v={capperAgg.green} />
            <Cov label="Red Days" v={capperAgg.red} />
            <Cov
              label="Green Avg ROI"
              v={fmtPct(capperAgg.green === 0 ? 0 : capperAgg.greenRoiCum / capperAgg.green)}
              tone={1}
            />
            <Cov
              label="Red Avg ROI"
              v={fmtPct(capperAgg.red === 0 ? 0 : capperAgg.redRoiCum / capperAgg.red)}
              tone={-1}
            />
          </div>
          <p className="text-[11px] text-ink-dim mt-2">
            Subtract these from your paper totals to compute the offset to enter below.
          </p>
        </div>

        <div className="bg-accent/5 border border-accent/20 rounded-md p-3">
          <div className="kpi-label text-[10px] mb-2 text-accent">
            Combined preview
          </div>
          <div className="grid grid-cols-2 gap-y-1 text-xs font-mono">
            <Cov label="Days" v={combined.days} />
            <Cov label="Bets" v={combined.bets} />
            <Cov label="$ Profit" v={fmtMoney(combined.amount, { sign: true })} tone={combined.amount} />
            <Cov label="Units" v={fmtUnits(combined.units)} tone={combined.units} />
            <Cov label="Total Risk" v={fmtMoney(combined.risk)} />
            <Cov label="W / L" v={`${combined.wins}-${combined.losses}`} />
            <Cov label="Green Days" v={combined.green} />
            <Cov label="Red Days" v={combined.red} />
            <Cov label="Green Avg ROI" v={fmtPct(combined.greenAvgRoi)} tone={1} />
            <Cov label="Red Avg ROI" v={fmtPct(combined.redAvgRoi)} tone={-1} />
            <Cov label="Green Day Probability" v={`${combined.greenProb.toFixed(0)}%`} />
          </div>
          <p className="text-[11px] text-ink-dim mt-2">
            What the dashboard will show as <strong>baseline-only</strong> totals once you save (before live tracked data is added).
          </p>
        </div>
      </div>

      <form ref={formRef} onSubmit={save} className="space-y-4">
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
          <Input label="Green day ROI cumulative (%)" step="0.0001"
            v={form.green_day_roi_cumulative}
            on={(x) => setForm((p) => ({ ...p, green_day_roi_cumulative: x }))} />
          <Input label="Red day ROI cumulative (%)" step="0.0001"
            v={form.red_day_roi_cumulative}
            on={(x) => setForm((p) => ({ ...p, red_day_roi_cumulative: x }))} />
        </Section>

        <Section
          title="Computed metrics"
          right={
            <button type="button" className="btn-ghost text-xs" onClick={autoDerive}>
              Auto-derive from totals
            </button>
          }
        >
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

        {err && <p className="text-bad text-sm">{err}</p>}
        {msg && <p className="text-accent text-sm">{msg}</p>}

        <div className="flex flex-wrap gap-2 justify-between pt-2 border-t border-border">
          {systemBaseline ? (
            <button type="button" className="btn-danger" onClick={clear} disabled={pending}>
              <Trash2 className="h-4 w-4" /> Remove system baseline
            </button>
          ) : (
            <span />
          )}
          <button type="submit" className="btn-primary" disabled={pending}>
            <Save className="h-4 w-4" />
            {pending ? "Saving..." : "Save system baseline"}
          </button>
        </div>
      </form>
    </div>
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

function Cov({
  label,
  v,
  tone,
}: {
  label: string;
  v: React.ReactNode;
  tone?: number;
}) {
  const cls =
    typeof tone === "number"
      ? tone > 0
        ? "text-good"
        : tone < 0
          ? "text-bad"
          : ""
      : "";
  return (
    <>
      <span className="text-ink-dim">{label}</span>
      <span className={`text-right ${cls}`}>{v}</span>
    </>
  );
}
