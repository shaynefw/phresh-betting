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

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function safeDiv(a: number, b: number): number {
  if (!b) return 0;
  return a / b;
}
