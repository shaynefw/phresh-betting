"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upsertCapperDay } from "../../_actions";
import { todayISO } from "@/lib/utils";

interface Props {
  capperId: string;
  systemId: string;
  unitSize: number;
}

export default function DayEntryForm({ capperId, systemId, unitSize }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"daily_totals" | "bet_level">("daily_totals");
  const [date, setDate] = useState(todayISO());
  const [wager, setWager] = useState("");
  const [bets, setBets] = useState("");
  const [pnl, setPnl] = useState("");
  const [wins, setWins] = useState("");
  const [losses, setLosses] = useState("");
  const [err, setErr] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    start(async () => {
      const res = await upsertCapperDay({
        capperId,
        systemId,
        date,
        entry_mode: mode,
        wager_total: mode === "daily_totals" ? Number(wager || 0) : 0,
        bet_count: mode === "daily_totals" ? Number(bets || 0) : 0,
        daily_amount_pnl: mode === "daily_totals" ? Number(pnl || 0) : 0,
        wins: mode === "daily_totals" ? Number(wins || 0) : 0,
        losses: mode === "daily_totals" ? Number(losses || 0) : 0,
      });
      if (res.error) {
        setErr(res.error);
        return;
      }
      setWager(""); setBets(""); setPnl(""); setWins(""); setLosses("");
      router.refresh();
    });
  }

  return (
    <div className="panel p-4">
      <div className="kpi-label mb-2">Add date</div>
      <div className="flex items-center gap-2 text-xs mb-3">
        <button
          type="button"
          className={`btn-ghost text-xs ${mode === "daily_totals" ? "border-accent text-accent" : ""}`}
          onClick={() => setMode("daily_totals")}
        >
          Daily Totals
        </button>
        <button
          type="button"
          className={`btn-ghost text-xs ${mode === "bet_level" ? "border-accent text-accent" : ""}`}
          onClick={() => setMode("bet_level")}
        >
          Bet-Level
        </button>
      </div>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="input"
            required
          />
        </div>

        {mode === "daily_totals" ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">Wager total ($)</label>
                <input type="number" step="0.01" value={wager}
                  onChange={(e) => setWager(e.target.value)} className="input" />
              </div>
              <div>
                <label className="label"># bets</label>
                <input type="number" value={bets}
                  onChange={(e) => setBets(e.target.value)} className="input" />
              </div>
              <div>
                <label className="label">Daily $ PnL</label>
                <input type="number" step="0.01" value={pnl}
                  onChange={(e) => setPnl(e.target.value)} className="input" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label">Wins</label>
                  <input type="number" value={wins}
                    onChange={(e) => setWins(e.target.value)} className="input" />
                </div>
                <div>
                  <label className="label">Losses</label>
                  <input type="number" value={losses}
                    onChange={(e) => setLosses(e.target.value)} className="input" />
                </div>
              </div>
            </div>
            <p className="text-xs text-ink-dim">
              1u = ${unitSize}. Units PnL is auto-derived.
            </p>
          </>
        ) : (
          <p className="text-xs text-ink-dim">
            Creates a bet-level day. Add individual bets in the editor below.
          </p>
        )}

        {err && <p className="text-bad text-sm">{err}</p>}
        <button className="btn-primary w-full" disabled={pending}>
          {pending ? "Saving..." : "Save day"}
        </button>
      </form>
    </div>
  );
}
