/**
 * Supported bet-level sport tags.
 *
 * `SPORT_ORDER` is the EXACT display order for the bet-entry Sport
 * dropdown — do not reorder without product sign-off. New sports
 * are added here and surface immediately in the UI without a schema
 * migration (the DB column has no CHECK constraint by design).
 */
export type Sport =
  | "NBA"
  | "WNBA"
  | "NCAAB"
  | "WNCAAB"
  | "MLB"
  | "NFL"
  | "NCAAF"
  | "NHL"
  | "TENNIS"
  | "SOCCER"
  | "NRL"
  | "GOLF"
  | "CRICKET"
  | "MMA";

export const SPORT_ORDER: readonly Sport[] = [
  "NBA",
  "WNBA",
  "NCAAB",
  "WNCAAB",
  "MLB",
  "NFL",
  "NCAAF",
  "NHL",
  "TENNIS",
  "SOCCER",
  "NRL",
  "GOLF",
  "CRICKET",
  "MMA",
] as const;

/** Narrowing guard — useful when reading the (untyped) `sport` column. */
export function isSport(s: string | null | undefined): s is Sport {
  if (!s) return false;
  return (SPORT_ORDER as readonly string[]).includes(s);
}
