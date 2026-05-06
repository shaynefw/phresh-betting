"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { importBackup } from "../_actions";
import { Download, Upload } from "lucide-react";

interface Props {
  systemId: string;
  payload: unknown;
}

export default function BackupTools({ systemId, payload }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [importJson, setImportJson] = useState("");
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

  function handleImport(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    start(async () => {
      const res = await importBackup(systemId, importJson);
      if (res.error) {
        setErr(res.error);
        return;
      }
      const s = res.summary;
      if (s) setMsg(`Imported ${s.cappers} cappers, ${s.days} days, ${s.bets} bets.`);
      router.refresh();
    });
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
        <form onSubmit={handleImport} className="space-y-3">
          <textarea
            className="input min-h-[140px] font-mono text-xs"
            placeholder="Paste backup JSON..."
            value={importJson}
            onChange={(e) => setImportJson(e.target.value)}
            required
          />
          {err && <p className="text-bad text-sm">{err}</p>}
          {msg && <p className="text-accent text-sm">{msg}</p>}
          <button className="btn-primary" disabled={pending}>
            <Upload className="h-4 w-4" />
            {pending ? "Importing..." : "Import backup"}
          </button>
        </form>
      </div>
    </div>
  );
}
