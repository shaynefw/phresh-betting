"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type SyntheticEvent,
} from "react";

/**
 * Word-by-word predictive autocomplete for the bet-level Notes field.
 *
 * Refinement of the prior full-sentence suggestor: now we never suggest
 * full notes — only individual words drawn from the user's historical
 * note vocabulary (across every capper in every system they own — see
 * the server fetch in cappers/[id]/page.tsx for the pool definition).
 *
 * UX rules:
 *   - Triggers when the partial word being typed reaches MIN_WORD_LEN.
 *   - "Current word" = the slice from the last whitespace (or string
 *     start) up to the caret. We only suggest when the caret is at the
 *     end of a word — i.e. the next char is whitespace or EOF — so
 *     mid-word edits never get hijacked.
 *   - On commit we replace ONLY the partial word with the chosen word,
 *     then append a trailing space so the user can immediately start
 *     typing the next word. The text after the caret is left intact.
 *   - Matching is prefix-only (case-insensitive). Pool order is already
 *     frequency-desc from the server, so the most-used words float to
 *     the top of the list automatically.
 *   - Keyboard: ArrowUp/Down navigate, Enter or Tab accept (only when
 *     a row is highlighted — otherwise default form behavior runs), Esc
 *     dismisses. Mouse/tap commit uses pointerdown so mobile blur
 *     doesn't beat the click.
 */

const MIN_WORD_LEN = 3;
const MAX_RESULTS = 8;

interface Props {
  value: string;
  onChange: (next: string) => void;
  /** Pre-sorted by frequency, deduped by lowercase form. */
  suggestions: string[];
  placeholder?: string;
  className?: string;
  id?: string;
  size?: "default" | "compact";
  name?: string;
}

interface WordContext {
  /** Substring from word-start up to the caret. Empty if no suggestion is valid here. */
  prefix: string;
  /** Inclusive start index of the current word in `value`. */
  start: number;
  /** Caret position in `value`. */
  caret: number;
}

/**
 * Locate the current "word in progress" given the value + caret.
 * Returns an empty prefix if the caret is in the middle of an existing
 * word (so we don't try to predict mid-word edits).
 */
function getWordContext(value: string, caret: number): WordContext {
  const c = Math.max(0, Math.min(caret, value.length));
  // Caret must be at end-of-word: either at EOF or on whitespace.
  const atEnd = c >= value.length || /\s/.test(value[c]);
  if (!atEnd) return { prefix: "", start: c, caret: c };
  // Walk left until we hit whitespace (or start of string).
  let start = c;
  while (start > 0 && !/\s/.test(value[start - 1])) start--;
  return { prefix: value.slice(start, c), start, caret: c };
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

  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Track caret position so we know which word the user is editing.
  // Initialized to end of value; kept in sync via input onChange + onSelect.
  const [caret, setCaret] = useState(value.length);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  // Clamp caret if value shrinks (e.g. external reset).
  useEffect(() => {
    if (caret > value.length) setCaret(value.length);
  }, [value.length, caret]);

  const ctx = useMemo(() => getWordContext(value, caret), [value, caret]);

  // Compute prefix matches against the (frequency-sorted) word pool.
  const matches = useMemo<string[]>(() => {
    if (ctx.prefix.length < MIN_WORD_LEN) return [];
    const needle = ctx.prefix.toLowerCase();
    const out: string[] = [];
    for (let i = 0; i < suggestions.length; i++) {
      const s = suggestions[i];
      // Prefix match; also skip the exact-equal case (already typed).
      if (s.length === needle.length) continue;
      if (s.toLowerCase().startsWith(needle)) {
        out.push(s);
        if (out.length >= MAX_RESULTS) break;
      }
    }
    return out;
  }, [ctx.prefix, suggestions]);

  // Sync dropdown open state + active index with computed matches.
  useEffect(() => {
    if (matches.length === 0) {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    setOpen(true);
    setActiveIndex((prev) => (prev >= matches.length || prev < 0 ? 0 : prev));
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

  /**
   * Replace only the partial word with the chosen suggestion.
   * Inserts a trailing space if one isn't already present after the
   * caret, so the next word starts naturally. Caret lands just after
   * the inserted word + space.
   */
  const commitWord = useCallback(
    (word: string) => {
      const { start, caret: c } = ctx;
      const before = value.slice(0, start);
      const after = value.slice(c);
      const needsSpace = !after.startsWith(" ");
      const insert = word + (needsSpace ? " " : "");
      const next = before + insert + after;
      const newCaret = before.length + insert.length;
      onChange(next);
      setOpen(false);
      setActiveIndex(-1);
      // Defer caret restoration to after React commits the new value.
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(newCaret, newCaret);
          setCaret(newCaret);
        }
      });
    },
    [ctx, onChange, value],
  );

  function onInputChange(e: ChangeEvent<HTMLInputElement>) {
    onChange(e.target.value);
    setCaret(e.target.selectionStart ?? e.target.value.length);
  }

  function onInputSelect(e: SyntheticEvent<HTMLInputElement>) {
    const el = e.currentTarget;
    setCaret(el.selectionStart ?? value.length);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open || matches.length === 0) {
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
      // Only intercept when an item is highlighted — otherwise let the
      // parent form's Enter submit / Tab focus-next work normally.
      if (activeIndex >= 0 && activeIndex < matches.length) {
        e.preventDefault();
        commitWord(matches[activeIndex]);
      }
      return;
    }
  }

  const inputClass = [
    "input",
    size === "compact" ? "h-8" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  const showDropdown = open && matches.length > 0;
  const prefixLen = ctx.prefix.length;

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
        onSelect={onInputSelect}
        onClick={onInputSelect}
        onFocus={onInputSelect}
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
          {matches.map((word, i) => {
            const isActive = i === activeIndex;
            const head = word.slice(0, prefixLen);
            const tail = word.slice(prefixLen);
            return (
              <li
                key={word + i}
                id={`${listboxId}-opt-${i}`}
                role="option"
                aria-selected={isActive}
                onPointerDown={(e) => {
                  e.preventDefault();
                  commitWord(word);
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
                <span className="font-mono">
                  <mark className="bg-accent/25 text-accent rounded-sm px-[1px] -mx-[1px]">
                    {head}
                  </mark>
                  {tail}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
