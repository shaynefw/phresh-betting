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
