"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addBet, deleteBet, updateBet } from "../../_actions";
import type { CapperBetEntry, CapperDayEntry } from "@/lib/types";
import { fmtMoney, fmtUnits, pctClass } from "@/lib/utils";
import { Trash2, Plus, Pencil, Check, X } from "lucide-react";

interface Props {
  day: CapperDayEntry;
  bets: CapperBetEntry[];
  capperId: string;
  systemId: string;
}

/**
 * Compute amount_pnl from American odds + wager + result.
 * Returns null only if odds or wager is missing (caller falls back to manual).
 */
function autoPnl(
  wager: number,
  odds: number | null,
  result: "win" | "loss" | "void",
): number | null {
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
  const [result, setResult] = useState<"win" | "loss" | "void">("win");
  const [pnl, setPnl] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);

  // -- Edit-row state --
  const [editingId, setEditingId] = useState<string | null>(null);
  const [eWager, setEWager] = useState("");
  const [eOdds, setEOdds] = useState("");
  const [eResult, setEResult] = useState<"win" | "loss" | "void">("win");
  const [ePnl, setEPnl] = useState("");
  const [eNotes, setENotes] = useState("");
  const [editErr, setEditErr] = useState<string | null>(null);

  function startEdit(b: CapperBetEntry) {
    setEditErr(null);
    setEditingId(b.id);
    setEWager(String(b.wager_amount ?? ""));
    setEOdds(b.odds == null ? "" : String(b.odds));
    setEResult((b.bet_result as "win" | "loss" | "void") ?? "win");
    setEPnl(String(b.amount_pnl ?? ""));
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
    // If the user blanked the PnL override, recompute from odds.
    let amount_pnl: number;
    if (ePnl === "") {
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
    let amount_pnl = pnl === "" ? null : Number(pnl);
    if (amount_pnl == null && odds && wager) {
      amount_pnl = autoPnl(Number(wager), Number(odds), result);
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
        amount_pnl: amount_pnl ?? 0,
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
          <div className="kpi-label">Bet-Level — {day.date}</div>
          <div className="text-xs text-ink-dim">
            Wager: {fmtMoney(day.wager_total)} ·{" "}
            <span className={pctClass(day.daily_amount_pnl)}>
              {fmtMoney(day.daily_amount_pnl, { sign: true })}
            </span>{" "}
            · <span className={pctClass(day.daily_units_pnl)}>{fmtUnits(day.daily_units_pnl)}</span>
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
                        onChange={(e) => setEResult(e.target.value as "win" | "loss" | "void")}
                      >
                        <option value="win">win</option>
                        <option value="loss">loss</option>
                        <option value="void">void</option>
                      </select>
                    </td>
                    <td className="text-right">
                      <input
                        className="input h-8 text-right"
                        type="number"
                        step="0.01"
                        value={ePnl}
                        onChange={(e) => setEPnl(e.target.value)}
                        placeholder="auto"
                      />
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
              return (
                <tr key={b.id}>
                  <td className="text-right">{fmtMoney(b.wager_amount)}</td>
                  <td className="text-right">{b.odds ?? "—"}</td>
                  <td>
                    <span className={
                      b.bet_result === "win" ? "pill-good" :
                      b.bet_result === "loss" ? "pill-bad" : "pill-mute"
                    }>
                      {b.bet_result}
                    </span>
                  </td>
                  <td className={`text-right ${pctClass(b.amount_pnl)}`}>
                    {fmtMoney(b.amount_pnl, { sign: true })}
                  </td>
                  <td className="text-ink-dim">{b.notes ?? ""}</td>
                  <td className="text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        className="btn-edit text-xs"
                        onClick={() => startEdit(b)}
                        disabled={pending || editingId !== null}
                        title="Edit bet"
                        aria-label="Edit bet"
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
          <select className="input" value={result} onChange={(e) => setResult(e.target.value as never)}>
            <option value="win">Win</option>
            <option value="loss">Loss</option>
            <option value="void">Void</option>
          </select>
        </div>
        <div>
          <label className="label">$ PnL (override)</label>
          <input className="input" type="number" step="0.01" value={pnl} onChange={(e) => setPnl(e.target.value)} placeholder="auto" />
        </div>
        <div className="md:col-span-2">
          <label className="label">Notes</label>
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
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
