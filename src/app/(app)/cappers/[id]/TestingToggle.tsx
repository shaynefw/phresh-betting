"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical, AlertTriangle } from "lucide-react";
import { toggleCapperTesting } from "../../_actions";

interface Props {
  capperId: string;
  systemId: string;
  isTesting: boolean;
}

/**
 * Per-capper Testing Phase control. When ON, the capper's data is
 * excluded from all system-wide aggregations (dashboard, journal,
 * combined performance summary, streak breakdown, etc.) while the
 * capper page itself keeps showing its own metrics normally.
 *
 * Renders as a colored banner when testing is active, and a discrete
 * "Enter Testing Phase" button when it's not.
 */
export default function TestingToggle({ capperId, systemId, isTesting }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function toggle(next: boolean) {
    start(async () => {
      await toggleCapperTesting(capperId, systemId, next);
      router.refresh();
    });
  }

  if (isTesting) {
    return (
      <div className="panel border-warn/40 bg-warn/10 p-3 md:p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="h-9 w-9 shrink-0 rounded-md bg-warn/15 text-warn grid place-items-center">
            <FlaskConical className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-warn text-[11px] tracking-widest uppercase font-semibold">
                Testing Phase Active
              </span>
              <AlertTriangle className="h-3.5 w-3.5 text-warn" />
            </div>
            <p className="text-xs text-ink-dim">
              This capper's data is excluded from all system-wide metrics.
              Individual capper metrics keep tracking normally.
            </p>
          </div>
        </div>
        <button
          type="button"
          className="btn-ghost shrink-0"
          onClick={() => toggle(false)}
          disabled={pending}
        >
          {pending ? "Saving..." : "Exit Testing Phase"}
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      className="btn-ghost"
      onClick={() => toggle(true)}
      disabled={pending}
      title="Exclude this capper's data from system-wide metrics"
    >
      <FlaskConical className="h-4 w-4" />
      {pending ? "Saving..." : "Enter Testing Phase"}
    </button>
  );
}
