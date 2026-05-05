"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const supabase = createClient();
    if (mode === "daily_totals") {
      const { error } = await supabase.from("capper_day_entries").upsert(
        {
          capper_id: capperId,
          system_id: systemId,
          date,
          entry_mode: "daily_totals",
          wager_total: Number(wager || 0),
          bet_count: Number(bets || 0),
          daily_amount_pnl: Number(pnl || 0),
          wins: Number(wins || 0),
          losses: Number(losses || 0),
        },
        { onConflict: "capper_id,date" },
      );
      if (error) return setErr(error.message);
    } else {
      // upsert empty day in bet-level mode; bets added below
      const { error } = await supabase.from("capper_day_entries").upsert(
        {
          capper_id: capperId,
          system_id: systemId,
          date,
          entry_mode: "bet_level",
          wager_total: 0,
          bet_count: 0,
          daily_amount_pnl: 0,
          wins: 0,
          losses: 0,
        },
        { onConflict: "capper_id,date" },
      );
      if (error) return setErr(error.message);
    }
    setWager(""); setBets(""); setPnl(""); setWins(""); setLosses("");
    start(() => router.refresh());
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
                <input
                  type="number"
                  step="0.01"
                  value={wager}
                  onChange={(e) => setWager(e.target.value)}
                  className="input"
                />
              </div>
              <div>
                <label className="label"># bets</label>
                <input
                  type="number"
                  value={bets}
                  onChange={(e) => setBets(e.target.value)}
                  className="input"
                />
              </div>
              <div>
                <label className="label">Daily $ PnL</label>
                <input
                  type="number"
                  step="0.01"
                  value={pnl}
                  onChange={(e) => setPnl(e.target.value)}
                  className="input"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label">Wins</label>
                  <input
                    type="number"
                    value={wins}
                    onChange={(e) => setWins(e.target.value)}
                    className="input"
                  />
                </div>
                <div>
                  <label className="label">Losses</label>
                  <input
                    type="number"
                    value={losses}
                    onChange={(e) => setLosses(e.target.value)}
                    className="input"
                  />
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
