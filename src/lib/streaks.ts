/**
 * Streak breakdown: walk days in date order, group consecutive green
 * (daily ROI > 0) and red (daily ROI < 0) days into streak runs.
 * Neutral days (ROI = 0) don't break the run — same rule used by the
 * recompute pipeline.
 *
 * Returns counts of how many times each (type, length) occurred.
 * Includes the currently ongoing streak as a "so far" snapshot.
 */

export type StreakColor = "green" | "red";

export interface StreakRun {
  type: StreakColor;
  length: number;
}

export interface StreakBreakdownEntry {
  type: StreakColor;
  length: number;
  count: number;
}

interface DayLike {
  date: string;
  daily_roi_percent: number | string;
}

export function computeStreakRuns(days: DayLike[]): StreakRun[] {
  const sorted = [...days].sort((a, b) => (a.date < b.date ? -1 : 1));
  const runs: StreakRun[] = [];
  let currentType: StreakColor | null = null;
  let currentLen = 0;

  for (const d of sorted) {
    const roi = Number(d.daily_roi_percent);
    let type: StreakColor | null = null;
    if (roi > 0) type = "green";
    else if (roi < 0) type = "red";
    else continue; // neutral — hold streak unchanged

    if (type === currentType) {
      currentLen++;
    } else {
      if (currentType && currentLen > 0) {
        runs.push({ type: currentType, length: currentLen });
      }
      currentType = type;
      currentLen = 1;
    }
  }
  if (currentType && currentLen > 0) {
    runs.push({ type: currentType, length: currentLen });
  }
  return runs;
}

export function streakBreakdown(days: DayLike[]): StreakBreakdownEntry[] {
  const runs = computeStreakRuns(days);
  const counts = new Map<string, number>();
  for (const r of runs) {
    const k = `${r.type}:${r.length}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const entries: StreakBreakdownEntry[] = [];
  for (const [k, count] of counts) {
    const [type, lenStr] = k.split(":");
    entries.push({
      type: type as StreakColor,
      length: Number(lenStr),
      count,
    });
  }
  // sort by count desc, then length asc, then green before red
  entries.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    if (a.length !== b.length) return a.length - b.length;
    return a.type === "green" ? -1 : 1;
  });
  return entries;
}
