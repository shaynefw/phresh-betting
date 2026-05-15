"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { importBackup } from "../_actions";
import { Download, Upload, FileText } from "lucide-react";

interface Props {
  systemId: string;
  payload: unknown;
}

export default function BackupTools({ systemId, payload }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [importJson, setImportJson] = useState("");
  const [filename, setFilename] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setErr(null);
    setMsg(null);
    try {
      const text = await f.text();
      // light validation that it parses
      const parsed = JSON.parse(text);
      if (!parsed?.system) {
        setErr("File is not a valid system backup (missing `system` field).");
        return;
      }
      setImportJson(text);
      setFilename(f.name);
    } catch (ex) {
      setErr(`Could not read file: ${ex instanceof Error ? ex.message : String(ex)}`);
    } finally {
      // reset the input so picking the same file again still fires onChange
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function handleImport(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    if (!importJson) {
      setErr("No backup to import. Choose a .json file or paste below.");
      return;
    }
    start(async () => {
      const res = await importBackup(systemId, importJson);
      if (res?.error) {
        setErr(res.error);
        return;
      }
      const s = res?.summary;
      if (s) {
        const parts = [
          `${s.cappers} cappers`,
          `${s.days} days`,
          `${s.bets} bets`,
        ];
        if ("baselines" in s && s.baselines) parts.push(`${s.baselines} capper baselines`);
        if ("system_baseline" in s && s.system_baseline) parts.push("system baseline");
        if ("chart_points" in s && s.chart_points) parts.push(`${s.chart_points} chart points`);
        setMsg(`Imported ${parts.join(", ")}.`);
      }
      setImportJson("");
      setFilename(null);
      router.refresh();
    });
  }

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="panel p-5">
        <h3 className="kpi-label mb-2">Export</h3>
        <p className="text-sm text-ink-dim mb-3">
          Download a complete JSON backup of this system: scaling log, cappers, days, bets, and historical baselines.
        </p>
        <button onClick={downloadJson} className="btn-primary">
          <Download className="h-4 w-4" /> Download JSON backup
        </button>
      </div>

      <div className="panel p-5">
        <h3 className="kpi-label mb-2">Import</h3>
        <p className="text-sm text-ink-dim mb-3">
          Restore from a JSON backup. <strong>This wipes the current system's cappers, days, bets, baselines, and scaling
          log</strong> before re-inserting.
        </p>
        <form onSubmit={handleImport} className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              onChange={onFile}
              className="hidden"
              id="backup-file"
            />
            <label htmlFor="backup-file" className="btn-ghost cursor-pointer">
              <FileText className="h-4 w-4" />
              {filename ? "Replace file" : "Choose .json file"}
            </label>
            {filename && (
              <span className="text-xs text-ink-dim truncate max-w-full">
                <span className="text-ink">{filename}</span>{" "}
                <button
                  type="button"
                  className="text-bad hover:underline ml-2"
                  onClick={() => {
                    setImportJson("");
                    setFilename(null);
                  }}
                >
                  clear
                </button>
              </span>
            )}
          </div>

          <details className="text-xs text-ink-dim">
            <summary className="cursor-pointer hover:text-ink">
              …or paste JSON manually
            </summary>
            <textarea
              className="input min-h-[140px] font-mono text-xs mt-2"
              placeholder="Paste backup JSON..."
              value={importJson}
              onChange={(e) => {
                setImportJson(e.target.value);
                if (filename) setFilename(null);
              }}
            />
          </details>

          {err && <p className="text-bad text-sm">{err}</p>}
          {msg && <p className="text-accent text-sm">{msg}</p>}

          <button
            type="submit"
            className="btn-primary"
            disabled={pending || !importJson}
          >
            <Upload className="h-4 w-4" />
            {pending ? "Importing..." : "Import backup"}
          </button>
        </form>
      </div>
    </div>
  );
}
