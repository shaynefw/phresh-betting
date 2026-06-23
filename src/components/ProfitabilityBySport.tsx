import SportIcon from "./SportIcon";
import { sportLabel, type Sport } from "@/lib/sports";
import { fmtMoney } from "@/lib/utils";

/**
 * Profitability by Sport — list + bar chart side by side on desktop,
 * stacked on mobile. Pure presentational: the page computes the per-
 * sport rollups inside whatever timeframe is active and hands them in.
 *
 * Sort order: net PnL descending — most profitable sport on top.
 *
 * Visual rules per spec:
 *   - Green for positive net, red for negative.
 *   - List shows sport name/icon, W-L record, dollar PnL.
 *   - Bar chart sizes each bar proportionally to |maxNet| so the most
 *     extreme value (positive or negative) reaches 100%.
 *   - Empty state when no graded bets fell in the scope.
 */
export interface SportRow {
  sport: Sport;
  wins: number;
  losses: number;
  netPnl: number;
}

interface Props {
  rows: SportRow[];
  /** Optional override; defaults to "Profitability by Sport". */
  title?: string;
  /** Optional subtitle (e.g. the active period label). */
  subtitle?: string;
}

export default function ProfitabilityBySport({ rows, title, subtitle }: Props) {
  return (
    <section className="panel p-4 md:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h3 className="kpi-label">{title ?? "Profitability by Sport"}</h3>
        {subtitle && (
          <span className="text-[11px] text-ink-dim normal-case tracking-normal">
            {subtitle}
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-ink-dim py-2">
          No graded bets with a sport tag in this timeframe.
        </p>
      ) : (
        <Layout rows={rows} />
      )}
    </section>
  );
}

function Layout({ rows }: { rows: SportRow[] }) {
  const sorted = [...rows].sort((a, b) => b.netPnl - a.netPnl);
  const maxAbs = Math.max(...sorted.map((r) => Math.abs(r.netPnl)), 1);

  return (
    <div className="grid md:grid-cols-2 gap-4 md:gap-6">
      {/* List view */}
      <ul className="divide-y divide-border">
        {sorted.map((r) => {
          const tone =
            r.netPnl > 0 ? "text-good" : r.netPnl < 0 ? "text-bad" : "text-ink-dim";
          return (
            <li
              key={r.sport}
              className="py-2 flex items-center justify-between gap-3"
            >
              <span className="flex items-center gap-2 min-w-0">
                <SportIcon sport={r.sport} size={14} />
                <span className="text-sm text-ink truncate">
                  {sportLabel(r.sport)}
                </span>
              </span>
              <span className="flex items-center gap-3 shrink-0">
                <span className="font-mono text-[11px] text-ink-dim tabular-nums">
                  {r.wins}-{r.losses}
                </span>
                <span className={`font-mono text-sm tabular-nums ${tone}`}>
                  {fmtMoney(r.netPnl, { sign: true })}
                </span>
              </span>
            </li>
          );
        })}
      </ul>

      {/* Bar chart view — horizontal bars, sport label + value flank the
          bar so even at narrow widths everything stays legible. */}
      <ul className="space-y-2">
        {sorted.map((r) => {
          const isPos = r.netPnl >= 0;
          const pct = (Math.abs(r.netPnl) / maxAbs) * 100;
          return (
            <li key={r.sport} className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 w-24 md:w-28 shrink-0">
                <SportIcon sport={r.sport} size={12} />
                <span className="text-xs text-ink truncate">
                  {sportLabel(r.sport)}
                </span>
              </span>
              {/* 2-half track so the zero line sits in the middle when both
                  green and red values exist. Positive bars grow rightward
                  from center; negative bars grow leftward. */}
              <span className="flex-1 grid grid-cols-2 h-3 bg-bg-panel/60 rounded overflow-hidden border border-border">
                <span className="relative">
                  {!isPos && (
                    <span
                      className="absolute right-0 top-0 bottom-0 bg-bad"
                      style={{ width: `${pct}%` }}
                    />
                  )}
                </span>
                <span className="relative">
                  {isPos && (
                    <span
                      className="absolute left-0 top-0 bottom-0 bg-good"
                      style={{ width: `${pct}%` }}
                    />
                  )}
                </span>
              </span>
              <span
                className={`font-mono text-[11px] tabular-nums w-16 text-right shrink-0 ${
                  isPos ? "text-good" : "text-bad"
                }`}
              >
                {fmtMoney(r.netPnl, { sign: true })}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
