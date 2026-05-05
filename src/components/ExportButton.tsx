"use client";

import { useState } from "react";
import { Camera } from "lucide-react";

export default function ExportButton({
  targetId,
  filename = "phresh-export.png",
  label = "Export PNG",
}: {
  targetId: string;
  filename?: string;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function exportPng() {
    setBusy(true);
    try {
      const node = document.getElementById(targetId);
      if (!node) return;
      const { toPng } = await import("html-to-image");
      const dataUrl = await toPng(node, {
        backgroundColor: "#05070d",
        pixelRatio: 2,
        cacheBust: true,
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = filename;
      a.click();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button onClick={exportPng} className="btn-ghost" disabled={busy}>
      <Camera className="h-4 w-4" />
      {busy ? "Exporting..." : label}
    </button>
  );
}
