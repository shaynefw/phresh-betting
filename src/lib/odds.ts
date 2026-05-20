/**
 * Odds math for averaging American odds correctly.
 *
 * American odds are non-linear: -110 ≠ -(+110) in payout. Averaging them
 * naively in American form produces meaningless results. The canonical
 * approach is to convert each to DECIMAL odds (a linear payout multiplier),
 * average those, then convert back to American.
 *
 * Worked example:
 *    Inputs: [-110, +150]
 *    Decimals: 1.9091, 2.5
 *    Mean decimal: 2.2045
 *    Back to American: (2.2045 − 1) × 100 ≈ +120
 */

/**
 * American → decimal odds.
 * -110 → 1.9091, +150 → 2.5. Returns null for 0 or non-finite input.
 */
export function americanToDecimal(american: number): number | null {
  if (!Number.isFinite(american) || american === 0) return null;
  return american > 0
    ? american / 100 + 1
    : 100 / Math.abs(american) + 1;
}

/**
 * Decimal → American odds.
 * 1.9091 → ≈−110, 2.5 → +150. Returns null for decimal ≤ 1 (no payout edge).
 */
export function decimalToAmerican(decimal: number): number | null {
  if (!Number.isFinite(decimal) || decimal <= 1) return null;
  return decimal >= 2 ? (decimal - 1) * 100 : -100 / (decimal - 1);
}

/**
 * Mathematically correct average of a list of American odds.
 *
 *   1. Convert each non-null odds value to decimal.
 *   2. Mean the decimals.
 *   3. Convert the mean back to American.
 *
 * Nulls, undefineds, and invalid entries (0 / non-finite) are skipped.
 * Returns null when no valid odds are present so callers can show a
 * graceful "—" fallback.
 */
export function averageAmericanOdds(
  odds: Array<number | null | undefined>,
): number | null {
  let sum = 0;
  let count = 0;
  for (const o of odds) {
    if (o == null) continue;
    const dec = americanToDecimal(Number(o));
    if (dec == null) continue;
    sum += dec;
    count += 1;
  }
  if (count === 0) return null;
  const mean = sum / count;
  return decimalToAmerican(mean);
}
