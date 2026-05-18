"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addBet, deleteBet, updateBet } from "../../_actions";
import type { CapperBetEntry, CapperDayEntry } from "@/lib/types";
import { fmtMoney, fmtUnits, pctClass } from "@/lib/utils";
import { Trash2, Plus, Pencil, Check, X, Clock } from "lucide-react";

interface Props {
  day: CapperDayEntry;
  bets: CapperBetEntry[];
  capperId: string;
  systemId: string;
}

type Result = "win" | "loss" | "void" | "pending";

/**
 * Compute amount_pnl from American odds + wager + result.
 * Returns null when result is "pending" (PnL is intentionally undefined until
 * the bet is resolved) or when odds/wager are missing.
 */
function autoPnl(
  wager: number,
  odds: number | null,
  result: Result,
): number | null {
  if (result === "pending") return null;
  if (!odds || !wager) return null;
  if (result === "win") {
    return odds > 0 ? (wager * odds) / 100 : (wager * 100) / Math.abs(odds);
  }
  if (result === "loss") return -wager;
  return 0; // void
}

export default function BetEntryEditor({ day, bets, capperId, systemId }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();

  // -- Add-bet form state --
  const [wager, setWager] = useState("");
  const [odds, setOdds] = useState("");
  const [result, setResult] = useState<Result>("win");
  const [pnl, setPnl] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);

  // -- Edit-row state --
  const [editingId, setEditingId] = useState<string | null>(null);
  const [eWager, setEWager] = useState("");
  const [eOdds, setEOdds] = useState("");
  const [eResult, setEResult] = useState<Result>("win");
  const [ePnl, setEPnl] = useState("");
  const [eNotes, setENotes] = useState("");
  const [editErr, setEditErr] = useState<string | null>(null);

  // How many bets are awaiting resolution? Surfaced in the day header so the
  // user sees there's outstanding work without scanning every row.
  const pendingCount = bets.filter((b) => b.bet_result === "pending").length;

  function startEdit(b: CapperBetEntry) {
    setEditErr(null);
    setEditingId(b.id);
    setEWager(String(b.wager_amount ?? ""));
    setEOdds(b.odds == null ? "" : String(b.odds));
    setEResult((b.bet_result as Result) ?? "win");
    // For pending rows, blank the PnL field so the user can leave it blank
    // until they actually know the result.
    setEPnl(b.bet_result === "pending" ? "" : String(b.amount_pnl ?? ""));
    setENotes(b.notes ?? "");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditErr(null);
  }

  function onSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    setEditErr(null);

    const w = Number(eWager || 0);
    const o = eOdds === "" ? null : Number(eOdds);
    // Pending bets always store amount_pnl = 0. The DB recompute filters
    // pending out of every aggregate, so the stored 0 is just a placeholder
    // — it never contributes to totals.
    let amount_pnl: number;
    if (eResult === "pending") {
      amount_pnl = 0;
    } else if (ePnl === "") {
      const auto = autoPnl(w, o, eResult);
      amount_pnl = auto ?? 0;
    } else {
      amount_pnl = Number(ePnl);
    }

    const id = editingId;
    start(async () => {
      const res = await updateBet({
        betId: id,
        capperId,
        systemId,
        wager_amount: w,
        odds: o,
        bet_result: eResult,
        amount_pnl,
        notes: eNotes || null,
      });
      if (res.error) {
        setEditErr(res.error);
        return;
      }
      setEditingId(null);
      router.refresh();
    });
  }

  function onAdd(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    // Pending: ignore any pnl input and store 0 (filtered out by DB recompute).
    let amount_pnl: number;
    if (result === "pending") {
      amount_pnl = 0;
    } else {
      const override = pnl === "" ? null : Number(pnl);
      amount_pnl =
        override ?? autoPnl(Number(wager || 0), odds ? Number(odds) : null, result) ?? 0;
    }
    start(async () => {
      const res = await addBet({
        capperDayEntryId: day.id,
        capperId,
        systemId,
        date: day.date,
        wager_amount: Number(wager || 0),
        odds: odds ? Number(odds) : null,
        bet_result: result,
        amount_pnl,
        notes: notes || null,
      });
      if (res.error) {
        setErr(res.error);
        return;
      }
      setWager(""); setOdds(""); setPnl(""); setNotes(""); setResult("win");
      router.refresh();
    });
  }

  function onDelete(id: string) {
    start(async () => {
      await deleteBet(id, systemId, capperId);
      router.refresh();
    });
  }

  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="kpi-label flex items-center gap-2 flex-wrap">
            Bet-Level — {day.date}
            {pendingCount > 0 && (
              <span
                className="pill-pending inline-flex items-center gap-1"
                title={`${pendingCount} bet${pendingCount === 1 ? "" : "s"} awaiting resolution`}
              >
                <Clock className="h-3 w-3" />
                {pendingCount} pending
              </span>
            )}
          </div>
          <div className="text-xs text-ink-dim">
            Wager: {fmtMoney(day.wager_total)} ·{" "}
            <span className={pctClass(day.daily_amount_pnl)}>
              {fmtMoney(day.daily_amount_pnl, { sign: true })}
            </span>{" "}
            · <span className={pctClass(day.daily_units_pnl)}>{fmtUnits(day.daily_units_pnl)}</span>
            {pendingCount > 0 && (
              <span className="text-pending ml-1">· excludes pending</span>
            )}
          </div>
        </div>
      </div>

      <div className="table-wrap mb-3">
        <table className="tbl font-mono">
          <thead>
            <tr>
              <th className="text-right">Wager</th>
              <th className="text-right">Odds</th>
              <th>Result</th>
              <th className="text-right">$ PnL</th>
              <th>Notes</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {bets.length === 0 && (
              <tr><td colSpan={6} className="text-center text-ink-dim py-3">No bets logged.</td></tr>
            )}
            {bets.map((b) => {
              const isEditing = editingId === b.id;
              if (isEditing) {
                const showPnlInput = eResult !== "pending";
                return (
                  <tr key={b.id}>
                    <td className="text-right">
                      <input
                        className="input h-8 text-right"
                        type="number"
                        step="0.01"
                        value={eWager}
                        onChange={(e) => setEWager(e.target.value)}
                      />
                    </td>
                    <td className="text-right">
                      <input
                        className="input h-8 text-right"
                        type="number"
                        step="1"
                        value={eOdds}
                        onChange={(e) => setEOdds(e.target.value)}
                        placeholder="-110"
                      />
                    </td>
                    <td>
                      <select
                        className="input h-8"
                        value={eResult}
                        onChange={(e) => setEResult(e.target.value as Result)}
                      >
                        <option value="win">win</option>
                        <option value="loss">loss</option>
                        <option value="void">void</option>
                        <option value="pending">pending</option>
                      </select>
                    </td>
                    <td className="text-right">
                      {showPnlInput ? (
                        <input
                          className="input h-8 text-right"
                          type="number"
                          step="0.01"
                          value={ePnl}
                          onChange={(e) => setEPnl(e.target.value)}
                          placeholder="auto"
                        />
                      ) : (
                        <span className="text-ink-dim text-xs italic">
                          — not yet resolved
                        </span>
                      )}
                    </td>
                    <td>
                      <input
                        className="input h-8"
                        value={eNotes}
                        onChange={(e) => setENotes(e.target.value)}
                      />
                    </td>
                    <td className="text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          className="btn-primary text-xs"
                          onClick={onSaveEdit}
                          disabled={pending}
                          title="Save"
                        >
                          <Check className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          className="btn-ghost text-xs"
                          onClick={cancelEdit}
                          disabled={pending}
                          title="Cancel"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                      {editErr && (
                        <div className="text-bad text-xs mt-1 whitespace-normal">{editErr}</div>
                      )}
                    </td>
                  </tr>
                );
              }
              const isPending = b.bet_result === "pending";
              return (
                <tr key={b.id} className={isPending ? "bg-pending/5" : ""}>
                  <td className="text-right">{fmtMoney(b.wager_amount)}</td>
                  <td className="text-right">{b.odds ?? "—"}</td>
                  <td>
                    {b.bet_result === "pending" ? (
                      <span className="pill-pending inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        pending
                      </span>
                    ) : (
                      <span
                        className={
                          b.bet_result === "win"
                            ? "pill-good"
                            : b.bet_result === "loss"
                            ? "pill-bad"
                            : "pill-mute"
                        }
                      >
                        {b.bet_result}
                      </span>
                    )}
                  </td>
                  <td
                    className={
                      isPending
                        ? "text-right text-pending italic"
                        : `text-right ${pctClass(b.amount_pnl)}`
                    }
                  >
                    {isPending ? "— awaiting result" : fmtMoney(b.amount_pnl, { sign: true })}
                  </td>
                  <td className="text-ink-dim">{b.notes ?? ""}</td>
                  <td className="text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        className="btn-edit text-xs"
                        onClick={() => startEdit(b)}
                        disabled={pending || editingId !== null}
                        title={isPending ? "Resolve this pending bet" : "Edit bet"}
                        aria-label={isPending ? "Resolve pending bet" : "Edit bet"}
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        className="btn-danger text-xs"
                        onClick={() => onDelete(b.id)}
                        disabled={pending || editingId !== null}
                        title="Delete bet"
                        aria-label="Delete bet"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <form onSubmit={onAdd} className="grid md:grid-cols-6 gap-2 items-end">
        <div>
          <label className="label">Wager</label>
          <input className="input" type="number" step="0.01" required value={wager} onChange={(e) => setWager(e.target.value)} />
        </div>
        <div>
          <label className="label">Odds (American)</label>
          <input className="input" type="number" step="1" value={odds} onChange={(e) => setOdds(e.target.value)} placeholder="-110" />
        </div>
        <div>
          <label className="label">Result</label>
          <select
            className="input"
            value={result}
            onChange={(e) => setResult(e.target.value as Result)}
          >
            <option value="win">Win</option>
            <option value="loss">Loss</option>
            <option value="void">Void</option>
            <option value="pending">Pending</option>
          </select>
        </div>
        <div>
          <label className="label">$ PnL (override)</label>
          <input
            className="input"
            type="number"
            step="0.01"
            value={pnl}
            onChange={(e) => setPnl(e.target.value)}
            placeholder={result === "pending" ? "not needed" : "auto"}
            disabled={result === "pending"}
          />
        </div>
        <div className="md:col-span-2">
          <label className="label">Notes</label>
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {result === "pending" && (
          <p className="text-pending text-xs md:col-span-6">
            Pending: this bet is logged but excluded from totals and the chart
            until you mark it Win / Loss / Void.
          </p>
        )}
        {err && <p className="text-bad text-sm md:col-span-6">{err}</p>}
        <div className="md:col-span-6">
          <button className="btn-primary" disabled={pending}>
            <Plus className="h-4 w-4" /> Add bet
          </button>
        </div>
      </form>
    </div>
  );
}
