import { fmtAmericanOdds, fmtMoney, fmtPct, fmtUnits } from "@/lib/utils";
import { TrendingUp, TrendingDown, Activity } from "lucide-react";

interface Props {
  title?: string;
  totalDays: number;
  totalBets: number;
  totalRisk: number;
  cumulativeAmount: number;
  cumulativeUnits: number;
  runningRoi: number;
  winRate: number;
  wins: number;
  losses: number;
  greenDays: number;
  redDays: number;
  greenAvgRoi: number;
  redAvgRoi: number;
  greenRoiCum: number;
  redRoiCum: number;
  greenProbability: number;
  currentStreakType: "green" | "red" | "neutral_hold";
  currentStreakValue: number;
  maxWinStreak: number;
  maxLossStreak: number;
  /**
   * Lifetime average American odds across every recorded bet for this
   * capper. Optional — pass null (or omit) when there are no bets with
   * odds; the row renders "—" and the metric is hidden from baseline-
   * only callers (e.g. the dashboard system-wide summary).
   */
  lifetimeAvgOdds?: number | null;
  /**
   * Lifetime average units risked per valid bet. Optional — pass null
   * (or omit) when there are no valid contributions. Renders as fmtUnits
   * or "—" right under Avg Odds (Lifetime).
   */
  lifetimeAvgUnitsRisked?: number | null;
  /** Optional badge (e.g. "+ baseline") shown next to the title */
  badge?: React.ReactNode;
}

export default function PerformanceSummary(p: Props) {
  return (
    <div className="panel p-3 md:p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="kpi-label">{p.title ?? "Performance Summary"}</h3>
        {p.badge}
      </div>

      <div className="grid grid-cols-2 gap-y-2 text-sm">
        <Row label="Total # of betting days" value={p.totalDays} />
        <Row
          label="Cumulative ($) Profit"
          value={fmtMoney(p.cumulativeAmount, { sign: true })}
          tone={p.cumulativeAmount}
        />
        <Row label="Total # of bets" value={p.totalBets} />
        <Row
          label="Win Rate"
          value={`${p.wins}-${p.losses} (${p.winRate.toFixed(0)}%)`}
        />
        <Row label="Total Risk" value={fmtMoney(p.totalRisk)} />
        <Row
          label="# Green Days (Avg ROI)"
          tone={1}
          value={`${p.greenDays} (${fmtPct(p.greenAvgRoi)})`}
        />
        <Row label="ROI" tone={p.runningRoi} value={fmtPct(p.runningRoi)} />
        <Row
          label="# Red Days (Avg ROI)"
          tone={-1}
          value={`${p.redDays} (${fmtPct(p.redAvgRoi)})`}
        />
        <Row
          label="Cumulative Units"
          tone={p.cumulativeUnits}
          value={fmtUnits(p.cumulativeUnits)}
        />
        <Row
          label="Green Day ROI Cumulative"
          tone={1}
          value={fmtPct(p.greenRoiCum)}
        />
        <Row
          label="Green Day Probability"
          value={`${p.greenProbability.toFixed(0)}%`}
        />
        <Row
          label="Red Day ROI Cumulative"
          tone={-1}
          value={fmtPct(p.redRoiCum)}
        />
        <Row label="Max Win Streak" tone={1} value={p.maxWinStreak} />
        <Row label="Max Loss Streak" tone={-1} value={p.maxLossStreak} />
        {p.lifetimeAvgOdds !== undefined && (
          <Row
            label="Avg Odds (Lifetime)"
            value={fmtAmericanOdds(p.lifetimeAvgOdds)}
          />
        )}
        {p.lifetimeAvgUnitsRisked !== undefined && (
          <Row
            label="Avg Units Risked (Lifetime)"
            value={
              p.lifetimeAvgUnitsRisked == null
                ? "—"
                : fmtUnits(p.lifetimeAvgUnitsRisked)
            }
          />
        )}
        <div className="text-ink-dim">Current Streak</div>
        <div
          className={`text-right font-mono flex items-center justify-end gap-2 ${
            p.currentStreakType === "green"
              ? "text-good"
              : p.currentStreakType === "red"
                ? "text-bad"
                : "text-ink-dim"
          }`}
        >
          {p.currentStreakType === "green" ? (
            <TrendingUp className="h-3.5 w-3.5" />
          ) : p.currentStreakType === "red" ? (
            <TrendingDown className="h-3.5 w-3.5" />
          ) : (
            <Activity className="h-3.5 w-3.5" />
          )}
          {p.currentStreakValue || "—"}
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
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
      <div className="text-ink-dim">{label}</div>
      <div className={`text-right font-mono ${cls}`}>{value}</div>
    </>
  );
}
