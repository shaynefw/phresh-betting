import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function fmtMoney(n: number, opts: { sign?: boolean } = {}): string {
  const sign = opts.sign && n > 0 ? "+" : "";
  const v = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${n < 0 ? "-" : sign}$${v}`;
}

export function fmtUnits(n: number, digits = 2): string {
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  return `${sign}${Math.abs(n).toFixed(digits)}u`;
}

export function fmtPct(n: number, digits = 2): string {
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  return `${sign}${Math.abs(n).toFixed(digits)}%`;
}

/**
 * "+150" / "-110" / "—" — American-odds formatter for the Avg Odds metric
 * and any other place that displays raw American odds. Rounds to the
 * nearest integer (American odds are conventionally whole numbers) and
 * gracefully falls back to em-dash for null / NaN / 0.
 */
export function fmtAmericanOdds(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n === 0) return "—";
  const rounded = Math.round(Number(n));
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

/**
 * "3-2 (60%)" — formats wins / losses + the win rate as a single string.
 * Mirrors the display style already used in PerformanceSummary, so the
 * per-day win-rate column matches the aggregated win-rate KPI.
 *
 * - Pushes / voids / pending / cancelled bets must NOT be passed here.
 *   `wins` and `losses` already exclude those (the recompute_capper SQL
 *   trigger only counts bet_result = 'win' or 'loss').
 * - 0-0 → safe "0-0 (0%)" fallback rather than NaN%.
 */
export function fmtWinLoss(wins: number, losses: number): string {
  const w = Math.max(0, Math.round(Number(wins) || 0));
  const l = Math.max(0, Math.round(Number(losses) || 0));
  const graded = w + l;
  const pct = graded === 0 ? 0 : Math.round((w / graded) * 100);
  return `${w}-${l} (${pct}%)`;
}

export function pctClass(n: number): string {
  if (n > 0) return "text-good";
  if (n < 0) return "text-bad";
  return "text-ink-dim";
}

/**
 * Returns the current calendar date as YYYY-MM-DD using LOCAL time.
 *
 * Prior implementation used `new Date().toISOString().slice(0, 10)`,
 * which formats the UTC date — so on a US client the "today" preset
 * inside DayEntryForm (Daily Totals + Bet-Level entry modes) would
 * roll over to tomorrow at midnight UTC, i.e. 8pm EST / 7pm EDT /
 * 5pm PDT. That's exactly the "afternoon or evening" rollover users
 * were hitting; bets entered after that point got dated as the next
 * day before the actual calendar had advanced.
 *
 * Using `getFullYear` / `getMonth` / `getDate` returns the local
 * calendar parts, so the date only advances when the user's clock
 * crosses midnight locally — matching the natural "today" that
 * users perceive. On the server (Vercel UTC), the function still
 * returns the server's local-which-is-UTC date; that only affects
 * fallback values for missing journal dates, where UTC is fine.
 */
export function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function safeDiv(a: number, b: number): number {
  if (!b) return 0;
  return a / b;
}
