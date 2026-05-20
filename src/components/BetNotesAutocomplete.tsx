"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ChangeEvent,
} from "react";

/**
 * Smart autocomplete for the bet-level Notes field.
 *
 * Suggestions come from the parent (server-fetched + deduped + frequency-
 * sorted across every capper in the user's active system). This component
 * does the live matching, ranking, and rendering of the dropdown.
 *
 * Matching:
 *   - Triggers when the trimmed input is at least 3 chars.
 *   - The query is split into words; ALL words must appear in a candidate
 *     note for it to match (case-insensitive substring).
 *   - Rank order:
 *       1. Word-boundary match (start of suggestion or after whitespace) wins
 *       2. Earlier-in-text match wins (lower indexOf)
 *       3. Stable on input order, so the parent's frequency sort is preserved
 *   - Up to MAX_RESULTS results shown.
 *
 * Keyboard:
 *   - ArrowDown / ArrowUp navigate
 *   - Enter or Tab accept the highlighted item — only intercepted when the
 *     dropdown is open with an active item (so the enclosing form's submit-
 *     on-Enter still works when no suggestion is selected)
 *   - Escape closes the dropdown without changing the value
 *
 * Mobile: standard <input> behavior, dropdown is `absolute`-positioned and
 * tappable; native browser autocomplete is disabled to avoid a double UI.
 */

const MIN_QUERY_LEN = 3;
const MAX_RESULTS = 8;

interface Props {
  value: string;
  onChange: (next: string) => void;
  /** Pre-sorted by frequency (most used first). De-duplicated by the parent. */
  suggestions: string[];
  placeholder?: string;
  className?: string;
  /** Optional input id (useful when associating with a <label htmlFor>). */
  id?: string;
  /** Height variant. Matches the existing input classes used in BetEntryEditor. */
  size?: "default" | "compact";
  /** Optional name attribute for the input element (used in form data). */
  name?: string;
}

interface Match {
  text: string;
  score: number;
  originalIndex: number;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Score a candidate note against a multi-word query.
 * Returns -1 if any query word is missing (the candidate is rejected).
 * Higher scores rank higher.
 */
function scoreMatch(note: string, queryWords: string[]): number {
  if (queryWords.length === 0) return -1;
  const lower = note.toLowerCase();
  let score = 0;
  for (const w of queryWords) {
    const idx = lower.indexOf(w);
    if (idx === -1) return -1;
    // Word-boundary match wins big (start of string OR preceded by whitespace
    // or common separators). Otherwise sub-word match.
    const prev = idx === 0 ? " " : lower[idx - 1];
    const atBoundary = idx === 0 || /[\s\-/(),.]/.test(prev);
    // Earlier position = better. Boundary match adds a large bonus.
    score += (atBoundary ? 1000 : 200) - idx;
  }
  return score;
}

/**
 * Split a suggestion into alternating plain / highlighted tokens for rendering.
 * Builds a regex from all unique query words (longest first so "cas" doesn't
 * eat "castillo"); String.split with a capturing group returns the matched
 * substrings interleaved with the surrounding text, which we render directly.
 */
function highlightTokens(suggestion: string, queryWords: string[]): React.ReactNode[] {
  if (queryWords.length === 0) return [suggestion];
  // Dedupe + longest-first so the regex prefers longer matches when overlap
  // exists. Filter empties to avoid the always-matching empty alternative.
  const unique = Array.from(new Set(queryWords.filter(Boolean))).sort(
    (a, b) => b.length - a.length,
  );
  if (unique.length === 0) return [suggestion];
  const pattern = new RegExp(`(${unique.map(escapeRegExp).join("|")})`, "ig");
  const parts = suggestion.split(pattern);
  return parts.map((p, i) =>
    i % 2 === 1 ? (
      // Matched chunk
      <mark
        key={i}
        className="bg-accent/25 text-accent rounded-sm px-[1px] -mx-[1px]"
      >
        {p}
      </mark>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

export default function BetNotesAutocomplete({
  value,
  onChange,
  suggestions,
  placeholder,
  className,
  id,
  size = "default",
  name,
}: Props) {
  const autoId = useId();
  const listboxId = `${id ?? autoId}-listbox`;

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Parse the current query into normalized words.
  const queryWords = useMemo(() => {
    const trimmed = value.trim().toLowerCase();
    if (trimmed.length < MIN_QUERY_LEN) return [] as string[];
    return trimmed.split(/\s+/).filter(Boolean);
  }, [value]);

  // Compute matches. Memoized so re-renders don't re-scan the array.
  const matches = useMemo<Match[]>(() => {
    if (queryWords.length === 0) return [];
    const out: Match[] = [];
    for (let i = 0; i < suggestions.length; i++) {
      const s = suggestions[i];
      const score = scoreMatch(s, queryWords);
      if (score < 0) continue;
      out.push({ text: s, score, originalIndex: i });
      // Soft cap exploration so very large lists stay snappy. Once we've
      // collected a healthy multiple of the visible limit, sort and cut.
      if (out.length > MAX_RESULTS * 6) break;
    }
    out.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.originalIndex - b.originalIndex; // stable on frequency rank
    });
    return out.slice(0, MAX_RESULTS);
  }, [queryWords, suggestions]);

  // Keep the dropdown's open state and the active index in sync with the
  // computed matches. We don't auto-open on focus — only when there's
  // actually something to show.
  useEffect(() => {
    if (matches.length === 0) {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    setOpen(true);
    // Reset active row to the top whenever the matches list changes shape.
    setActiveIndex((prev) => (prev >= matches.length ? 0 : prev));
  }, [matches]);

  // Click-outside closes the dropdown.
  useEffect(() => {
    if (!open) return;
    function onDocPointer(e: PointerEvent) {
      if (!rootRef.current) return;
      if (rootRef.current.contains(e.target as Node)) return;
      setOpen(false);
      setActiveIndex(-1);
    }
    document.addEventListener("pointerdown", onDocPointer);
    return () => document.removeEventListener("pointerdown", onDocPointer);
  }, [open]);

  const commit = useCallback(
    (text: string) => {
      onChange(text);
      setOpen(false);
      setActiveIndex(-1);
      // Refocus so the user can keep typing if they want to extend the note.
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [onChange],
  );

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open || matches.length === 0) {
      // Esc still closes any leftover state if open
      if (e.key === "Escape") {
        setOpen(false);
        setActiveIndex(-1);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % matches.length);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? matches.length - 1 : i - 1));
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      // Only intercept when a suggestion is highlighted. If no row is
      // active, defer to default behavior (form submit on Enter, focus
      // next field on Tab) so we never hijack normal typing.
      if (activeIndex >= 0 && activeIndex < matches.length) {
        e.preventDefault();
        commit(matches[activeIndex].text);
      }
      return;
    }
  }

  function onInputChange(e: ChangeEvent<HTMLInputElement>) {
    onChange(e.target.value);
  }

  // Sized to mirror the existing .input utility (regular vs. h-8 in the row editor)
  const inputClass = [
    "input",
    size === "compact" ? "h-8" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  const showDropdown = open && matches.length > 0;

  return (
    <div className="relative" ref={rootRef}>
      <input
        ref={inputRef}
        id={id}
        name={name}
        type="text"
        className={inputClass}
        value={value}
        placeholder={placeholder}
        onChange={onInputChange}
        onKeyDown={onKeyDown}
        onFocus={() => {
          if (matches.length > 0) setOpen(true);
        }}
        // Disable native browser autocomplete + spellcheck UI fighting ours.
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        aria-autocomplete="list"
        aria-expanded={showDropdown}
        aria-controls={showDropdown ? listboxId : undefined}
        aria-activedescendant={
          showDropdown && activeIndex >= 0
            ? `${listboxId}-opt-${activeIndex}`
            : undefined
        }
        role="combobox"
      />

      {showDropdown && (
        <ul
          id={listboxId}
          role="listbox"
          className="
            absolute left-0 right-0 top-full mt-1 z-30
            max-h-72 overflow-y-auto
            rounded-md border border-border bg-bg-elevated shadow-card
            text-sm
          "
        >
          {matches.map((m, i) => {
            const isActive = i === activeIndex;
            return (
              <li
                key={`${m.originalIndex}-${m.text}`}
                id={`${listboxId}-opt-${i}`}
                role="option"
                aria-selected={isActive}
                // pointerdown (not click) so the input's blur handler doesn't
                // close the dropdown before the click registers on mobile.
                onPointerDown={(e) => {
                  e.preventDefault();
                  commit(m.text);
                }}
                onMouseEnter={() => setActiveIndex(i)}
                className={`
                  px-3 py-2 cursor-pointer leading-snug
                  ${
                    isActive
                      ? "bg-accent/15 text-ink"
                      : "text-ink hover:bg-bg-card"
                  }
                `}
              >
                <span className="block whitespace-pre-wrap break-words">
                  {highlightTokens(m.text, queryWords)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
