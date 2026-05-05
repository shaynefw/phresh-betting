"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Download, Upload } from "lucide-react";

interface Props {
  systemId: string;
  payload: unknown;
}

export default function BackupTools({ systemId, payload }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [importJson, setImportJson] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function downloadJson() {
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `system-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importBackup(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      const data = JSON.parse(importJson);
      if (!data.system || !Array.isArray(data.scaling))
        throw new Error("Unrecognized backup format");
      const supabase = createClient();

      // wipe existing system contents (preserve system row itself)
      await supabase.from("scaling_log_entries").delete().eq("system_id", systemId);
      await supabase.from("capper_bet_entries").delete().eq("system_id", systemId);
      await supabase.from("capper_day_entries").delete().eq("system_id", systemId);
      await supabase.from("cappers").delete().eq("system_id", systemId);

      // map old IDs to new IDs as we re-insert
      const capperIdMap = new Map<string, string>();
      const dayIdMap = new Map<string, string>();

      // scaling
      const scalingRows = (data.scaling ?? []).map((r: Record<string, unknown>) => ({
        ...r,
        id: undefined,
        system_id: systemId,
      }));
      if (scalingRows.length) {
        const { error } = await supabase.from("scaling_log_entries").insert(scalingRows);
        if (error) throw error;
      }

      // cappers
      for (const c of data.cappers ?? []) {
        const { data: ins, error } = await supabase
          .from("cappers")
          .insert({
            system_id: systemId,
            name: c.name,
            base_system_risk_units: c.base_system_risk_units,
            is_active: c.is_active,
            is_archived: c.is_archived,
            current_phase: c.current_phase,
            checklist_status: c.checklist_status,
            sort_order: c.sort_order ?? 0,
            notes: c.notes ?? null,
          })
          .select("id")
          .single();
        if (error || !ins) throw error;
        capperIdMap.set(c.id, ins.id);
      }

      // capper days
      for (const d of data.capper_days ?? []) {
        const newCapperId = capperIdMap.get(d.capper_id);
        if (!newCapperId) continue;
        const { data: ins, error } = await supabase
          .from("capper_day_entries")
          .insert({
            capper_id: newCapperId,
            system_id: systemId,
            date: d.date,
            entry_mode: d.entry_mode,
            wager_total: d.wager_total,
            bet_count: d.bet_count,
            daily_amount_pnl: d.daily_amount_pnl,
            wins: d.wins,
            losses: d.losses,
            unit_size_used: d.unit_size_used,
            notes: d.notes ?? null,
          })
          .select("id")
          .single();
        if (error || !ins) throw error;
        dayIdMap.set(d.id, ins.id);
      }

      // bets
      const betRows: unknown[] = [];
      for (const b of data.capper_bets ?? []) {
        const newDay = dayIdMap.get(b.capper_day_entry_id);
        const newCapper = capperIdMap.get(b.capper_id);
        if (!newDay || !newCapper) continue;
        betRows.push({
          capper_day_entry_id: newDay,
          capper_id: newCapper,
          system_id: systemId,
          date: b.date,
          wager_amount: b.wager_amount,
          odds: b.odds,
          bet_result: b.bet_result,
          amount_pnl: b.amount_pnl,
          units_risk_multiplier: b.units_risk_multiplier,
          notes: b.notes ?? null,
        });
      }
      if (betRows.length) {
        const { error } = await supabase.from("capper_bet_entries").insert(betRows as never);
        if (error) throw error;
      }

      setMsg(`Imported ${capperIdMap.size} cappers, ${dayIdMap.size} days, ${betRows.length} bets.`);
      start(() => router.refresh());
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : String(e);
      setErr(m);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="panel p-5">
        <h3 className="kpi-label mb-2">Export</h3>
        <p className="text-sm text-ink-dim mb-3">
          Download a complete JSON backup of this system: scaling log, cappers, days, bets.
        </p>
        <button onClick={downloadJson} className="btn-primary">
          <Download className="h-4 w-4" /> Download JSON backup
        </button>
      </div>
      <div className="panel p-5">
        <h3 className="kpi-label mb-2">Import</h3>
        <p className="text-sm text-ink-dim mb-3">
          Restore from a JSON backup. <strong>This wipes the current system's cappers, days, bets, and scaling
          log</strong> before re-inserting.
        </p>
        <form onSubmit={importBackup} className="space-y-3">
          <textarea
            className="input min-h-[140px] font-mono text-xs"
            placeholder="Paste backup JSON..."
            value={importJson}
            onChange={(e) => setImportJson(e.target.value)}
            required
          />
          {err && <p className="text-bad text-sm">{err}</p>}
          {msg && <p className="text-accent text-sm">{msg}</p>}
          <button className="btn-primary" disabled={busy || pending}>
            <Upload className="h-4 w-4" />
            {busy ? "Importing..." : "Import backup"}
          </button>
        </form>
      </div>
    </div>
  );
}
