import { Flame } from "lucide-react";
import type { StreakBreakdownEntry } from "@/lib/streaks";

interface Props {
  entries: StreakBreakdownEntry[];
  /** Optional override for the section title (e.g. capper page) */
  title?: string;
}

export default function StreakBreakdown({ entries, title }: Props) {
  return (
    <div className="panel p-3 md:p-5 relative overflow-hidden">
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
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 md:gap-3">
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
      className={`relative rounded-md border p-2.5 md:p-3 bg-bg-panel/60 ${
        isGreen
          ? "border-good/30 hover:border-good/50"
          : "border-bad/30 hover:border-bad/50"
      } transition-colors`}
    >
      <div className="flex items-center gap-2 text-xs md:text-sm">
        <span
          className={`h-2.5 w-2.5 rounded-full ${
            isGreen
              ? "bg-good shadow-[0_0_8px_rgba(34,197,94,0.6)]"
              : "bg-bad shadow-[0_0_8px_rgba(239,68,68,0.6)]"
          }`}
        />
        <span className="text-ink-dim">
          {entry.length} {entry.type}
          {entry.length > 1 ? "s" : ""}:
        </span>
      </div>
      <div className="font-mono text-2xl md:text-3xl font-bold mt-0.5 text-ink">
        {entry.count}
      </div>
      <div
        className={`absolute bottom-0 left-2 right-2 h-px ${
          isGreen
            ? "bg-gradient-to-r from-transparent via-good/60 to-transparent"
            : "bg-gradient-to-r from-transparent via-bad/60 to-transparent"
        }`}
      />
    </div>
  );
}
