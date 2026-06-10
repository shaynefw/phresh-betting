"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Download, Upload, FileText } from "lucide-react";

interface Props {
  systemId: string;
  payload: unknown;
}

type ImportPhase =
  | { kind: "idle" }
  | { kind: "uploading"; sent: number; total: number }
  | { kind: "processing" }
  | { kind: "done" };

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export default function BackupTools({ systemId, payload }: Props) {
  const router = useRouter();
  const [importJson, setImportJson] = useState("");
  const [filename, setFilename] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [phase, setPhase] = useState<ImportPhase>({ kind: "idle" });
  const fileRef = useRef<HTMLInputElement>(null);
  const inFlight = phase.kind === "uploading" || phase.kind === "processing";

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
    // Parse client-side so we can hand the route handler a single JSON
    // body (rather than a wrapped string) and so we surface format
    // errors before paying for an upload round-trip.
    let parsed: unknown;
    try {
      parsed = JSON.parse(importJson);
    } catch {
      setErr("Invalid JSON");
      return;
    }

    // XHR (not fetch) — we want upload-progress events for the body
    // send so the user sees the bar move. Server-side processing of
    // the wipe+reinsert is shown as an indeterminate "Processing…"
    // step once the upload byte stream finishes.
    const body = JSON.stringify({ systemId, payload: parsed });
    const total = body.length;
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/import-backup");
    xhr.setRequestHeader("content-type", "application/json");

    type ImportResponse = {
      error?: string;
      summary?: Record<string, number | boolean>;
    };

    setPhase({ kind: "uploading", sent: 0, total });

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) {
        setPhase({ kind: "uploading", sent: ev.loaded, total: ev.total });
      }
    };
    xhr.upload.onload = () => {
      // Bytes are out the door; server is now doing the wipe + insert.
      setPhase({ kind: "processing" });
    };
    xhr.onerror = () => {
      setPhase({ kind: "idle" });
      setErr("Network error during upload");
    };
    xhr.onload = () => {
      let json: ImportResponse | null = null;
      try {
        json = JSON.parse(xhr.responseText) as ImportResponse;
      } catch {
        // Non-JSON response (likely a 500 HTML error page).
      }
      if (xhr.status < 200 || xhr.status >= 300 || json?.error) {
        setPhase({ kind: "idle" });
        setErr(json?.error ?? `Import failed (HTTP ${xhr.status})`);
        return;
      }
      const s = json?.summary;
      if (s) {
        const parts = [
          `${s.cappers} cappers`,
          `${s.days} days`,
          `${s.bets} bets`,
        ];
        if (s.baselines) parts.push(`${s.baselines} capper baselines`);
        if (s.system_baseline) parts.push("system baseline");
        if (s.chart_points) parts.push(`${s.chart_points} chart points`);
        if (s.journal_baseline_days)
          parts.push(`${s.journal_baseline_days} journal baseline days`);
        setMsg(`Backup imported successfully — ${parts.join(", ")}.`);
      } else {
        setMsg("Backup imported successfully.");
      }
      setPhase({ kind: "done" });
      setImportJson("");
      setFilename(null);
      router.refresh();
    };

    xhr.send(body);
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
          {msg && (
            <p className="text-good text-sm flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{msg}</span>
            </p>
          )}

          {/* Progress strip — visible during upload AND server-side
              processing so the user knows the page isn't frozen. */}
          {inFlight && (
            <div className="space-y-1.5" aria-live="polite">
              <div className="flex justify-between text-xs text-ink-dim font-mono">
                <span>
                  {phase.kind === "uploading"
                    ? `Uploading ${fmtBytes(phase.sent)} / ${fmtBytes(phase.total)}`
                    : "Processing on server…"}
                </span>
                <span>
                  {phase.kind === "uploading"
                    ? `${Math.round((phase.sent / Math.max(1, phase.total)) * 100)}%`
                    : ""}
                </span>
              </div>
              <div className="h-2 rounded-full bg-bg-panel overflow-hidden border border-border">
                {phase.kind === "uploading" ? (
                  <div
                    className="h-full bg-accent transition-[width] duration-150"
                    style={{
                      width: `${Math.round((phase.sent / Math.max(1, phase.total)) * 100)}%`,
                    }}
                  />
                ) : (
                  // Indeterminate: full bar with pulse so the user sees
                  // motion while Supabase does the wipe + reinsert.
                  <div className="h-full bg-accent animate-pulse" />
                )}
              </div>
              {phase.kind === "processing" && (
                <p className="text-[11px] text-ink-dim">
                  Wiping current data and rebuilding the system. Large backups
                  can take 20–40 seconds — don&rsquo;t close this tab.
                </p>
              )}
            </div>
          )}

          <button
            type="submit"
            className="btn-primary"
            disabled={inFlight || !importJson}
          >
            <Upload className="h-4 w-4" />
            {phase.kind === "uploading"
              ? "Uploading…"
              : phase.kind === "processing"
                ? "Importing…"
                : "Import backup"}
          </button>
        </form>
      </div>
    </div>
  );
}
