import { Flame } from "lucide-react";
import type { StreakBreakdownEntry } from "@/lib/streaks";

interface Props {
  entries: StreakBreakdownEntry[];
  /** Optional override for the section title (e.g. capper page) */
  title?: string;
}

export default function StreakBreakdown({ entries, title }: Props) {
  return (
    <div className="panel p-3 md:p-5 relative">
      <div className="flex items-center gap-2 mb-3">
        <Flame className="h-4 w-4 text-accent" />
        <h3 className="kpi-label text-accent">
          {title ?? "Streak Breakdown"}{" "}
          <span className="text-ink-dim">(by days)</span>
        </h3>
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-ink-dim">
          No streaks yet. Log a day to start the count.
        </p>
      ) : (
        <div
          className="grid gap-1.5 md:gap-2"
          style={{
            gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
          }}
        >
          {entries.map((e) => (
            <Card key={`${e.type}-${e.length}`} entry={e} />
          ))}
        </div>
      )}
    </div>
  );
}

function Card({ entry }: { entry: StreakBreakdownEntry }) {
  const isGreen = entry.type === "green";
  return (
    <div
      className={`relative rounded-md border px-2 py-1.5 bg-bg-panel/60 ${
        isGreen
          ? "border-good/30 hover:border-good/50"
          : "border-bad/30 hover:border-bad/50"
      } transition-colors`}
    >
      <div className="flex items-center gap-1.5 text-[11px]">
        <span
          className={`h-2 w-2 rounded-full shrink-0 ${
            isGreen
              ? "bg-good shadow-[0_0_6px_rgba(34,197,94,0.6)]"
              : "bg-bad shadow-[0_0_6px_rgba(239,68,68,0.6)]"
          }`}
        />
        <span className="text-ink-dim leading-none">
          {entry.length} {entry.type}
          {entry.length > 1 ? "s" : ""}:
        </span>
      </div>
      <div className="font-mono text-lg md:text-xl font-bold leading-tight mt-0.5 text-ink">
        {entry.count}
      </div>
      <div
        className={`absolute bottom-0 left-1.5 right-1.5 h-px ${
          isGreen
            ? "bg-gradient-to-r from-transparent via-good/60 to-transparent"
            : "bg-gradient-to-r from-transparent via-bad/60 to-transparent"
        }`}
      />
    </div>
  );
}
