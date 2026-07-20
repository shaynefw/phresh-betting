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

  // Both columns render one fixed-height row per sport in the same
  // sorted order, so each list row lines up on the exact same
  // horizontal plane as its bar row. ROW_H is shared; the list rows
  // carry a visible divider and the chart rows carry a transparent one
  // of identical thickness so the two columns never drift.
  const ROW_H = "h-10";

  return (
    <div className="grid md:grid-cols-2 gap-x-6 md:gap-x-10 gap-y-4">
      {/* Left column — sport identity + record. The PnL total lives at
          the far right of the row (end of the bar), so it isn't
          duplicated here. */}
      <ul>
        {sorted.map((r) => (
          <li
            key={r.sport}
            className={`${ROW_H} flex items-center justify-between gap-3 border-b border-border last:border-0`}
          >
            <span className="flex items-center gap-2 min-w-0">
              <SportIcon sport={r.sport} size={14} />
              <span className="text-sm text-ink truncate">
                {sportLabel(r.sport)}
              </span>
            </span>
            <span className="font-mono text-sm text-ink-dim tabular-nums shrink-0">
              {recordLabel(r.wins, r.losses)}
            </span>
          </li>
        ))}
      </ul>

      {/* Right column — bar + the row's single PnL total. Sport
          icon/name are intentionally omitted; they're already on the
          left and each bar row aligns 1:1 with its list row. */}
      <ul>
        {sorted.map((r) => {
          const isPos = r.netPnl >= 0;
          const pct = (Math.abs(r.netPnl) / maxAbs) * 100;
          return (
            <li
              key={r.sport}
              className={`${ROW_H} flex items-center gap-3 border-b border-transparent last:border-0`}
            >
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
                className={`font-mono text-sm tabular-nums w-24 text-right shrink-0 ${
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

/**
 * "7-5 (58.3%)" — win-loss record with win percentage. The percentage
 * is omitted when there are no graded bets so we never print "(NaN%)"
 * or a meaningless "(0.0%)" for an empty record.
 */
function recordLabel(wins: number, losses: number): string {
  const total = wins + losses;
  if (total === 0) return `${wins}-${losses}`;
  const pct = (wins / total) * 100;
  return `${wins}-${losses} (${pct.toFixed(1)}%)`;
}
