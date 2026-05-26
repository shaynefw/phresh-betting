"use client";

import { useState, useTransition, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { History, Trash2, Save, X, FileUp } from "lucide-react";
import {
  clearJournalBaseline,
  replaceJournalBaseline,
} from "@/app/(app)/_actions";
import type { JournalBaselineDay } from "@/lib/types";
import { fmtMoney, fmtUnits, pctClass } from "@/lib/utils";

/**
 * Journal Baseline Importer.
 *
 * Lets a user upload pre-tracking history (per-date wager / bets /
 * $ PnL / units / wins / losses) so the Daily Betting Journal's
 * cumulative columns (Cum $, Cum Units, Run ROI, Streak) flow
 * continuously from the imported baseline forward.
 *
 * Accepts BOTH formats — the textarea / file upload auto-detects:
 *   - JSON: array of `{ date, wager|total_wager, bets|total_bets,
 *     pnl|daily_amount_pnl, units|daily_units_pnl, wins, losses, notes }`
 *   - CSV : header row required; columns: date, wager, bets, pnl,
 *     units, wins, losses, notes (order flexible — header matches by
 *     name). Common aliases accepted (total_wager, daily_amount_pnl,
 *     etc.).
 *
 * Empty / invalid rows are silently skipped during parsing so a tiny
 * formatting glitch doesn't abort the whole import. Dates outside
 * YYYY-MM-DD format are dropped with a warning.
 */

interface Props {
  systemId: string;
  initialRows: JournalBaselineDay[];
}

interface ParsedRow {
  date: string;
  total_wager: number;
  total_bets: number;
  daily_amount_pnl: number;
  daily_units_pnl: number;
  wins: number;
  losses: number;
  notes: string | null;
}

const FIELD_ALIASES: Record<string, keyof ParsedRow> = {
  date: "date",
  day: "date",
  wager: "total_wager",
  total_wager: "total_wager",
  risk: "total_wager",
  bets: "total_bets",
  total_bets: "total_bets",
  "# bets": "total_bets",
  pnl: "daily_amount_pnl",
  "$ pnl": "daily_amount_pnl",
  daily_amount_pnl: "daily_amount_pnl",
  profit: "daily_amount_pnl",
  units: "daily_units_pnl",
  daily_units_pnl: "daily_units_pnl",
  u: "daily_units_pnl",
  wins: "wins",
  w: "wins",
  losses: "losses",
  l: "losses",
  notes: "notes",
};

function emptyRow(date: string): ParsedRow {
  return {
    date,
    total_wager: 0,
    total_bets: 0,
    daily_amount_pnl: 0,
    daily_units_pnl: 0,
    wins: 0,
    losses: 0,
    notes: null,
  };
}

function assign(row: ParsedRow, key: keyof ParsedRow, raw: unknown) {
  if (key === "date") {
    row.date = String(raw ?? "").trim();
    return;
  }
  if (key === "notes") {
    row.notes = raw == null || raw === "" ? null : String(raw);
    return;
  }
  const n = Number(raw);
  if (Number.isFinite(n)) {
    // typescript: numeric fields only
    (row as Record<keyof ParsedRow, number | string | null>)[key] = n;
  }
}

function parseJSON(text: string): ParsedRow[] {
  const data = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error("Top-level value must be an array");
  const out: ParsedRow[] = [];
  for (const r of data) {
    if (!r || typeof r !== "object") continue;
    const row = emptyRow("");
    for (const [k, v] of Object.entries(r as Record<string, unknown>)) {
      const mapped = FIELD_ALIASES[k.toLowerCase()];
      if (!mapped) continue;
      assign(row, mapped, v);
    }
    if (row.date) out.push(row);
  }
  return out;
}

function splitCsvLine(line: string): string[] {
  // Minimal CSV splitter — handles quoted fields with commas.
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQ = false; }
      } else cur += ch;
    } else {
      if (ch === ",") { out.push(cur); cur = ""; }
      else if (ch === '"') inQ = true;
      else cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

function parseCSV(text: string): ParsedRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/^\$/, "").trim());
  const out: ParsedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    if (cells.every((c) => c === "")) continue;
    const row = emptyRow("");
    for (let c = 0; c < headers.length; c++) {
      const mapped = FIELD_ALIASES[headers[c]];
      if (!mapped) continue;
      assign(row, mapped, cells[c]);
    }
    if (row.date) out.push(row);
  }
  return out;
}

function parseAny(text: string): { rows: ParsedRow[]; format: "json" | "csv" } {
  const t = text.trim();
  if (t.startsWith("[") || t.startsWith("{")) {
    return { rows: parseJSON(t), format: "json" };
  }
  return { rows: parseCSV(t), format: "csv" };
}

function validate(rows: ParsedRow[]): { ok: ParsedRow[]; rejected: number } {
  const ok: ParsedRow[] = [];
  let rejected = 0;
  const seen = new Set<string>();
  for (const r of rows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) {
      rejected++;
      continue;
    }
    if (seen.has(r.date)) {
      // dedupe: first wins
      rejected++;
      continue;
    }
    seen.add(r.date);
    ok.push(r);
  }
  return { ok, rejected };
}

export default function JournalBaselineImporter({
  systemId,
  initialRows,
}: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<ParsedRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  function parse() {
    setError(null);
    setInfo(null);
    if (!text.trim()) {
      setError("Paste JSON or CSV, or upload a file first.");
      setParsed(null);
      return;
    }
    try {
      const { rows, format } = parseAny(text);
      const { ok, rejected } = validate(rows);
      setParsed(ok);
      setInfo(
        `Detected ${format.toUpperCase()} · ${ok.length} valid row${ok.length === 1 ? "" : "s"}` +
          (rejected > 0
            ? ` · ${rejected} skipped (invalid date or duplicate)`
            : ""),
      );
    } catch (e) {
      setError(
        "Could not parse input: " +
          (e instanceof Error ? e.message : "unknown error"),
      );
      setParsed(null);
    }
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const t = await f.text();
    setText(t);
    setParsed(null);
    setInfo(`Loaded ${f.name} (${f.size} bytes) — click Parse + Preview.`);
    setError(null);
  }

  function apply() {
    if (!parsed || parsed.length === 0) return;
    start(async () => {
      const res = await replaceJournalBaseline({
        systemId,
        rows: parsed.map((r) => ({
          date: r.date,
          total_wager: r.total_wager,
          total_bets: r.total_bets,
          daily_amount_pnl: r.daily_amount_pnl,
          daily_units_pnl: r.daily_units_pnl,
          wins: r.wins,
          losses: r.losses,
          notes: r.notes,
        })),
      });
      if ("error" in res && res.error) {
        setError(res.error);
        return;
      }
      setOpen(false);
      setText("");
      setParsed(null);
      setInfo(null);
      router.refresh();
    });
  }

  function clear() {
    if (
      !confirm(
        "Remove all imported journal baseline rows? The Daily Betting Journal will recompute from tracked data only.",
      )
    )
      return;
    start(async () => {
      await clearJournalBaseline(systemId);
      router.refresh();
    });
  }

  const count = initialRows.length;

  return (
    <>
      <button
        type="button"
        className={`btn-ghost text-xs ${
          count > 0 ? "border-accent/40 text-accent" : ""
        }`}
        onClick={() => setOpen(true)}
        title={
          count > 0
            ? `${count} baseline day${count === 1 ? "" : "s"} imported`
            : "Import historical baseline days"
        }
      >
        <History className="h-3.5 w-3.5" />
        Baseline import
        {count > 0 && <span className="ml-1 text-[10px]">({count})</span>}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => !pending && setOpen(false)}
          />
          <div className="relative z-10 w-full max-w-3xl panel p-4 md:p-6 max-h-[90vh] overflow-y-auto rounded-t-2xl md:rounded-xl">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-[10px] tracking-[0.4em] text-accent uppercase">
                  Journal
                </div>
                <h2 className="text-lg md:text-xl font-bold">
                  Daily Betting Journal — Baseline Import
                </h2>
              </div>
              <button
                type="button"
                onClick={() => !pending && setOpen(false)}
                className="p-2 rounded-md hover:bg-bg-card"
                aria-label="Close"
              >
                <X className="h-5 w-5 text-ink" />
              </button>
            </div>

            <p className="text-xs text-ink-dim mb-3">
              Upload pre-tracking history as JSON or CSV. Each row needs a{" "}
              <span className="text-ink font-mono">date</span> (YYYY-MM-DD) plus{" "}
              <span className="text-ink font-mono">wager</span>,{" "}
              <span className="text-ink font-mono">bets</span>,{" "}
              <span className="text-ink font-mono">pnl</span>,{" "}
              <span className="text-ink font-mono">units</span>,{" "}
              <span className="text-ink font-mono">wins</span>,{" "}
              <span className="text-ink font-mono">losses</span>. After applying,
              every cumulative column on the Journal (Cum $, Cum Units, Run ROI,
              Streak) will be recalculated from the earliest baseline date
              forward — tracked dates flow continuously from where the baseline
              ends.
            </p>

            <div className="space-y-3">
              <label className="flex items-center gap-2 text-xs">
                <span className="btn-ghost text-xs cursor-pointer pointer-events-none">
                  <FileUp className="h-3.5 w-3.5" />
                  Choose file
                </span>
                <input
                  type="file"
                  accept=".json,.csv,.txt"
                  onChange={onFile}
                  className="text-xs file:hidden"
                />
                <span className="text-ink-dim">or paste below</span>
              </label>

              <textarea
                className="input min-h-[140px] font-mono text-xs"
                placeholder={`JSON:
[
  { "date": "2026-04-30", "wager": 100, "bets": 5, "pnl": 25, "units": 0.50, "wins": 3, "losses": 2 }
]

— or CSV with a header row —
date,wager,bets,pnl,units,wins,losses,notes
2026-04-30,100,5,25,0.50,3,2,`}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setParsed(null);
                }}
              />

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={parse}
                  disabled={pending}
                >
                  Parse + Preview
                </button>
                {parsed && parsed.length > 0 && (
                  <button
                    type="button"
                    className="btn-primary text-xs"
                    onClick={apply}
                    disabled={pending}
                  >
                    <Save className="h-3.5 w-3.5" />
                    {pending ? "Applying…" : `Apply ${parsed.length} day${parsed.length === 1 ? "" : "s"}`}
                  </button>
                )}
                {count > 0 && (
                  <button
                    type="button"
                    className="btn-danger text-xs ml-auto"
                    onClick={clear}
                    disabled={pending}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Clear baseline ({count})
                  </button>
                )}
              </div>

              {info && <p className="text-xs text-accent">{info}</p>}
              {error && <p className="text-bad text-sm">{error}</p>}

              {parsed && parsed.length > 0 && (
                <div className="table-wrap text-xs">
                  <table className="tbl font-mono">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th className="text-right">Bets</th>
                        <th className="text-right">Wager</th>
                        <th className="text-right">$ PnL</th>
                        <th className="text-right">Units</th>
                        <th className="text-right">W-L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.slice(0, 30).map((r) => (
                        <tr key={r.date}>
                          <td>{r.date}</td>
                          <td className="text-right">{r.total_bets}</td>
                          <td className="text-right">
                            {fmtMoney(r.total_wager)}
                          </td>
                          <td
                            className={`text-right ${pctClass(r.daily_amount_pnl)}`}
                          >
                            {fmtMoney(r.daily_amount_pnl, { sign: true })}
                          </td>
                          <td
                            className={`text-right ${pctClass(r.daily_units_pnl)}`}
                          >
                            {fmtUnits(r.daily_units_pnl)}
                          </td>
                          <td className="text-right">
                            {r.wins}-{r.losses}
                          </td>
                        </tr>
                      ))}
                      {parsed.length > 30 && (
                        <tr>
                          <td
                            colSpan={6}
                            className="text-center text-ink-dim py-2 italic"
                          >
                            … {parsed.length - 30} more row
                            {parsed.length - 30 === 1 ? "" : "s"} not shown.
                            Applying will import all {parsed.length}.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
              {parsed && parsed.length === 0 && (
                <p className="text-sm text-ink-dim italic">
                  No valid rows detected — check date format and column names.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
