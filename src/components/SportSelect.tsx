"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { ChevronDown } from "lucide-react";
import SportIcon from "./SportIcon";
import { SPORT_ORDER, sportLabel, type Sport } from "@/lib/sports";

/**
 * Custom combobox for the bet-level Sport tag.
 *
 * Why custom (not <select>): native <option> elements can't render the
 * outlined SVG sport icons next to each name. This component matches
 * the .input utility's height + styling so it slots into the existing
 * BetEntryEditor forms (add row + inline edit row) without visual drift.
 *
 * Behavior:
 *   - Closed: shows the current sport's icon + label, or the placeholder.
 *   - Open: scrollable list, each row icon + label, current row bolded.
 *   - Includes a top "Clear sport" row when value is set, so users can
 *     untag a bet without picking a different sport.
 *   - Keyboard: Up/Down navigate, Enter selects active, Esc closes,
 *     Space/Enter/Down opens from the trigger.
 *   - Outside-click + Escape both close cleanly.
 *   - pointerdown (not click) on options so mobile blur doesn't beat tap.
 *   - aria-haspopup / aria-expanded / aria-selected for accessibility.
 */

interface Props {
  value: Sport | null;
  onChange: (next: Sport | null) => void;
  placeholder?: string;
  size?: "default" | "compact";
  id?: string;
  className?: string;
}

export default function SportSelect({
  value,
  onChange,
  placeholder = "Select sport…",
  size = "default",
  id,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);

  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Outside-click closes the popup.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: PointerEvent) {
      if (!rootRef.current) return;
      if (rootRef.current.contains(e.target as Node)) return;
      setOpen(false);
      setActiveIndex(-1);
    }
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, [open]);

  const openMenu = useCallback(() => {
    setOpen(true);
    setActiveIndex(value ? SPORT_ORDER.indexOf(value) : 0);
  }, [value]);

  const commit = useCallback(
    (next: Sport | null) => {
      onChange(next);
      setOpen(false);
      setActiveIndex(-1);
      requestAnimationFrame(() => buttonRef.current?.focus());
    },
    [onChange],
  );

  function onKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % SPORT_ORDER.length);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) =>
        i <= 0 ? SPORT_ORDER.length - 1 : i - 1,
      );
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < SPORT_ORDER.length) {
        commit(SPORT_ORDER[activeIndex]);
      }
      return;
    }
  }

  // Match the .input utility, but as a flex button. The chevron lives at
  // the right edge so the value never overlaps it.
  const triggerClass = [
    "input",
    size === "compact" ? "h-8" : "",
    "flex items-center justify-between gap-2 text-left",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="relative" ref={rootRef}>
      <button
        ref={buttonRef}
        id={id}
        type="button"
        className={triggerClass}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKey}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 min-w-0 truncate">
          {value ? (
            <>
              <SportIcon sport={value} size={14} />
              <span className="truncate">{sportLabel(value)}</span>
            </>
          ) : (
            <span className="text-muted truncate">{placeholder}</span>
          )}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-ink-dim shrink-0" />
      </button>

      {open && (
        <ul
          role="listbox"
          className="
            absolute left-0 right-0 top-full mt-1 z-30
            max-h-72 overflow-y-auto
            rounded-md border border-border bg-bg-elevated shadow-card
            text-sm
          "
        >
          {value !== null && (
            <li
              role="option"
              aria-selected={false}
              onPointerDown={(e) => {
                e.preventDefault();
                commit(null);
              }}
              className="px-3 py-2 text-ink-dim italic cursor-pointer hover:bg-bg-card border-b border-border"
            >
              Clear sport
            </li>
          )}
          {SPORT_ORDER.map((s, i) => {
            const isActive = i === activeIndex;
            const isSelected = value === s;
            return (
              <li
                key={s}
                role="option"
                aria-selected={isSelected}
                onPointerDown={(e) => {
                  e.preventDefault();
                  commit(s);
                }}
                onMouseEnter={() => setActiveIndex(i)}
                className={`
                  px-3 py-2 cursor-pointer flex items-center gap-2
                  ${
                    isActive
                      ? "bg-accent/15 text-ink"
                      : "text-ink hover:bg-bg-card"
                  }
                  ${isSelected ? "font-semibold" : ""}
                `}
              >
                <SportIcon sport={s} size={14} />
                <span>{sportLabel(s)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
