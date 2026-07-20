import type { JournalDayEntry } from "@/lib/types";
import { fmtMoney, fmtPct, fmtUnits, fmtWinLoss } from "@/lib/utils";

/**
 * Per-day KPI panel shared by /dashboard and /bets.
 *
 * The two pages always show identical numbers for the same selected
 * date — that's why this lives in a shared component instead of being
 * copy/pasted into each route. Pulls everything from a single
 * JournalDayEntry row (already maintained by the recompute_journal SQL
 * trigger), so the panel just renders — no business logic here.
 *
 * Pass `dayJournal = null` for dates that have no journal row (e.g. a
 * day with zero bets); every metric falls back to "0"/"—" gracefully.
 */

interface Props {
  focusDate: string;
  dayJournal: JournalDayEntry | null;
  /** Override the section title. Defaults to "Daily Summary — {focusDate}". */
  title?: string;
  /**
   * Timeframe-aware label for the $ Profit tile (e.g. "Weekly $
   * Profit"). Defaults to "Daily $ Profit" so existing single-day
   * callers (e.g. /bets) render exactly as before.
   */
  profitLabel?: string;
  /**
   * Timeframe-aware label for the units tile. Defaults to the legacy
   * "Cumulative Units" wording so /bets renders unchanged.
   */
  unitsLabel?: string;
}

export default function DailySummary({
  focusDate,
  dayJournal,
  title,
  profitLabel = "Daily $ Profit",
  unitsLabel = "Cumulative Units",
}: Props) {
  return (
    <div className="panel p-3 md:p-5">
      <h3 className="kpi-label mb-3">
        {title ?? `Daily Summary — ${focusDate}`}
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <MiniStat label="Total # of bets" value={dayJournal?.total_bets ?? 0} />
        <MiniStat label="Total Risk" value={fmtMoney(dayJournal?.total_wager ?? 0)} />
        <MiniStat
          label="ROI"
          value={fmtPct(dayJournal?.daily_roi_percent ?? 0)}
          tone={dayJournal?.daily_roi_percent ?? 0}
        />
        <MiniStat
          label={unitsLabel}
          value={fmtUnits(dayJournal?.daily_units_pnl ?? 0)}
          tone={dayJournal?.daily_units_pnl ?? 0}
        />
        <MiniStat
          label={profitLabel}
          value={fmtMoney(dayJournal?.daily_amount_pnl ?? 0, { sign: true })}
          tone={dayJournal?.daily_amount_pnl ?? 0}
        />
        <MiniStat
          label="Win Rate"
          value={
            dayJournal
              ? fmtWinLoss(
                  Number(dayJournal.wins ?? 0),
                  Number(dayJournal.losses ?? 0),
                )
              : "—"
          }
          tone={
            dayJournal
              ? Number(dayJournal.wins ?? 0) - Number(dayJournal.losses ?? 0)
              : undefined
          }
        />
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: number;
}) {
  const cls =
    typeof tone === "number" ? (tone > 0 ? "text-good" : tone < 0 ? "text-bad" : "") : "";
  return (
    <div className="bg-bg-panel/60 rounded-md p-3">
      <div className="kpi-label text-[10px] mb-1">{label}</div>
      <div className={`font-mono text-base ${cls}`}>{value}</div>
    </div>
  );
}
