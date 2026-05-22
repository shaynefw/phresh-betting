"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Calendar as CalendarIcon } from "lucide-react";
import type { TimeframeKind } from "@/lib/timeframe";

/**
 * Segmented timeframe control + custom-range popover.
 *
 * Renders the Day / Week / Month / Year / All buttons as plain text with
 * a strong bottom-border underline on the active item (per the attached
 * visual reference: clean, segmented feel — no pills, no card boxes).
 *
 * A trailing Calendar icon opens an inline popover containing two date
 * inputs (from / to). Submitting the popover form navigates to
 * `?timeframe=custom&from=…&to=…` so the dashboard server-renders the
 * range.
 *
 * Buttons preserve the current `date` param when switching between
 * Day/Week/Month/Year so the user stays anchored to the same date as
 * they widen / narrow the view.
 */

interface Props {
  kind: TimeframeKind;
  /** ISO YYYY-MM-DD — the current focus / anchor date. */
  anchorDate: string;
  /** Custom range bounds (only used when kind === 'custom'). */
  from?: string | null;
  to?: string | null;
}

interface TabDef {
  kind: Exclude<TimeframeKind, "custom">;
  label: string;
}

const TABS: TabDef[] = [
  { kind: "day", label: "Day" },
  { kind: "week", label: "Week" },
  { kind: "month", label: "Month" },
  { kind: "year", label: "Year" },
  { kind: "all", label: "All" },
];

function buildHref(
  pathname: string,
  current: URLSearchParams,
  patch: Record<string, string | null>,
): string {
  const next = new URLSearchParams(current);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) next.delete(k);
    else next.set(k, v);
  }
  const qs = next.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export default function TimeframeNav({ kind, anchorDate, from, to }: Props) {
  const pathname = usePathname() ?? "/dashboard";
  const sp = useSearchParams();
  const router = useRouter();
  const currentParams = new URLSearchParams(sp?.toString() ?? "");

  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Custom range form state — initialized from URL so the inputs reflect
  // the active selection when the popover reopens.
  const [customFrom, setCustomFrom] = useState<string>(
    from ?? anchorDate ?? "",
  );
  const [customTo, setCustomTo] = useState<string>(to ?? anchorDate ?? "");

  useEffect(() => {
    setCustomFrom(from ?? anchorDate ?? "");
    setCustomTo(to ?? anchorDate ?? "");
  }, [from, to, anchorDate]);

  // Outside-click + Escape close the popover.
  useEffect(() => {
    if (!pickerOpen) return;
    function onDoc(e: PointerEvent) {
      if (!pickerRef.current) return;
      if (pickerRef.current.contains(e.target as Node)) return;
      setPickerOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPickerOpen(false);
    }
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [pickerOpen]);

  const applyCustomRange = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!customFrom || !customTo) return;
      const next = new URLSearchParams(sp?.toString() ?? "");
      next.set("timeframe", "custom");
      next.set("from", customFrom);
      next.set("to", customTo);
      next.delete("date");
      router.push(`${pathname}?${next.toString()}`);
      setPickerOpen(false);
    },
    [customFrom, customTo, pathname, router, sp],
  );

  return (
    <div className="flex items-end gap-4 border-b border-border">
      <nav className="flex items-stretch gap-1" aria-label="Timeframe">
        {TABS.map((t) => {
          const isActive = kind === t.kind;
          const href = buildHref(pathname, currentParams, {
            timeframe: t.kind,
            // Keep `date` for day/week/month/year so the user stays
            // anchored when switching scopes. Strip it on "all" to
            // avoid confusion (anchor doesn't apply).
            ...(t.kind === "all" ? { date: null } : {}),
            from: null,
            to: null,
          });
          return (
            <Link
              key={t.kind}
              href={href}
              prefetch={false}
              className={[
                "relative px-3 py-2 text-sm font-medium transition select-none",
                isActive
                  ? "text-accent"
                  : "text-ink-dim hover:text-ink",
              ].join(" ")}
              aria-current={isActive ? "page" : undefined}
            >
              {t.label}
              <span
                className={[
                  "pointer-events-none absolute left-0 right-0 -bottom-px h-[2px]",
                  isActive ? "bg-accent" : "bg-transparent",
                ].join(" ")}
                aria-hidden
              />
            </Link>
          );
        })}
      </nav>

      <div ref={pickerRef} className="relative ml-auto pb-1">
        <button
          type="button"
          onClick={() => setPickerOpen((p) => !p)}
          aria-haspopup="dialog"
          aria-expanded={pickerOpen}
          aria-label="Custom date range"
          title="Custom date range"
          className={[
            "flex items-center gap-1.5 px-2 py-1.5 text-xs rounded-md border transition",
            kind === "custom"
              ? "border-accent/50 text-accent bg-accent/10"
              : "border-border text-ink-dim hover:text-ink hover:border-accent/40",
          ].join(" ")}
        >
          <CalendarIcon className="h-4 w-4" />
          {kind === "custom" ? "Custom" : "Custom range"}
        </button>
        {pickerOpen && (
          <div
            role="dialog"
            aria-label="Pick a custom date range"
            className="
              absolute right-0 top-full mt-2 z-30
              w-72 panel p-3 space-y-3 shadow-card
            "
          >
            <div className="kpi-label text-[10px]">Custom Range</div>
            <form className="space-y-3" onSubmit={applyCustomRange}>
              <div>
                <label className="label" htmlFor="tf-from">From</label>
                <input
                  id="tf-from"
                  type="date"
                  className="input"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="label" htmlFor="tf-to">To</label>
                <input
                  id="tf-to"
                  type="date"
                  className="input"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  required
                />
              </div>
              <p className="text-[10px] text-ink-dim leading-snug">
                Pick the same date for a one-day view, or a range spanning
                weeks, months, or years.
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => setPickerOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary text-xs">
                  Apply
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
