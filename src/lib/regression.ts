/**
 * Ordinary least-squares linear regression for the cumulative-units chart.
 *
 *   y = m*x + b
 *
 *   m = (n·Σxy − Σx·Σy) / (n·Σx² − (Σx)²)
 *   b = (Σy − m·Σx) / n
 *
 * Returns null when fewer than 2 points or when all x values are equal
 * (vertical line — no defined slope).
 */

export interface LinearFit {
  slope: number;
  intercept: number;
}

export function linearRegression<T extends { x: number; y: number }>(
  points: T[],
): LinearFit | null {
  if (points.length < 2) return null;
  const n = points.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumXX += p.x * p.x;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

/**
 * Convenience: enriches a chart-data array with a `trendline` field
 * containing y = m*x + b for each row. Returns a shallow copy.
 * `xKey` and `yKey` default to "day" and "cumulativeUnits" to match
 * the chart shape used in the dashboard + capper pages.
 */
export function withRegressionTrendline<
  T extends { [k: string]: unknown },
>(
  rows: T[],
  xKey: keyof T = "day" as keyof T,
  yKey: keyof T = "cumulativeUnits" as keyof T,
): (T & { trendline: number | null })[] {
  const pts = rows.map((r) => ({
    x: Number(r[xKey]),
    y: Number(r[yKey]),
  }));
  const fit = linearRegression(pts);
  return rows.map((r, i) => ({
    ...r,
    trendline: fit ? fit.slope * pts[i].x + fit.intercept : null,
  }));
}
