"use client";

import { useEffect, useState } from "react";
import { Link2, Copy, Check, Trash2, Globe, Lock } from "lucide-react";

/**
 * Read-only share-link control for a betting system.
 *
 *   - No token → "Create share link" button (calls createAction).
 *   - Token set → shows the full public URL, Copy, and Revoke.
 *
 * The URL is assembled client-side from window.location.origin so it's
 * correct in every environment (local / preview / prod) without needing
 * a configured base URL. The token itself comes from the server as a
 * prop; this component never generates it.
 */

interface Props {
  systemId: string;
  shareToken: string | null;
  createAction: (formData: FormData) => void;
  revokeAction: (formData: FormData) => void;
}

export default function ShareLink({
  systemId,
  shareToken,
  createAction,
  revokeAction,
}: Props) {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const shareUrl = shareToken ? `${origin}/share/${shareToken}` : "";

  async function copy() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked (insecure context / permissions) — no-op; the
      // input is selectable so the user can copy manually.
    }
  }

  return (
    <div className="panel p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Link2 className="h-4 w-4 text-accent" />
        <div className="kpi-label">Read-only Share Link</div>
        {shareToken ? (
          <span className="pill-good text-[10px] flex items-center gap-1">
            <Globe className="h-3 w-3" /> Public
          </span>
        ) : (
          <span className="pill-mute text-[10px] flex items-center gap-1">
            <Lock className="h-3 w-3" /> Private
          </span>
        )}
      </div>

      <p className="text-xs text-ink-dim">
        Generate a link that lets anyone view this system&rsquo;s
        performance <strong className="text-ink">read-only</strong> — no
        sign-in required and no way to edit. Revoke it any time to make the
        system private again.
      </p>

      {shareToken ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              readOnly
              value={shareUrl || "…"}
              onFocus={(e) => e.currentTarget.select()}
              className="input flex-1 min-w-[220px] font-mono text-xs"
              aria-label="Public share URL"
            />
            <button
              type="button"
              onClick={copy}
              className="btn-ghost text-xs shrink-0"
              disabled={!shareUrl}
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4" /> Copied
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" /> Copy
                </>
              )}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {shareUrl && (
              <a
                href={shareUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-accent hover:underline"
              >
                Open shared view →
              </a>
            )}
            <form action={revokeAction} className="ml-auto">
              <input type="hidden" name="id" value={systemId} />
              <button className="btn-danger text-xs">
                <Trash2 className="h-4 w-4" /> Revoke link
              </button>
            </form>
          </div>
          <p className="text-[11px] text-ink-dim">
            Revoking immediately disables the current link. Creating a new
            one later generates a different URL.
          </p>
        </div>
      ) : (
        <form action={createAction}>
          <input type="hidden" name="id" value={systemId} />
          <button className="btn-primary">
            <Link2 className="h-4 w-4" /> Create share link
          </button>
        </form>
      )}
    </div>
  );
}
