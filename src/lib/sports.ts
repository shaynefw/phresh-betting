/**
 * Supported bet-level sport tags.
 *
 * `SPORT_ORDER` is the EXACT display order for the bet-entry Sport
 * dropdown — do not reorder without product sign-off. New sports
 * are added here and surface immediately in the UI without a schema
 * migration (the DB column has no CHECK constraint by design).
 *
 * `SPORT_LABEL` is the human-readable string shown in dropdowns and
 * tables. For most sports this is identical to the key (e.g. "NFL");
 * it diverges only when the league's natural label is more than a
 * pure acronym (e.g. "NCAA Baseball").
 */
export type Sport =
  | "NBA"
  | "WNBA"
  | "NCAAB"
  | "WNCAAB"
  | "MLB"
  | "NCAABASEBALL"
  | "NFL"
  | "CFL"
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
  "NCAABASEBALL",
  "NFL",
  "CFL",
  "NCAAF",
  "NHL",
  "TENNIS",
  "SOCCER",
  "NRL",
  "GOLF",
  "CRICKET",
  "MMA",
] as const;

export const SPORT_LABEL: Record<Sport, string> = {
  NBA: "NBA",
  WNBA: "WNBA",
  NCAAB: "NCAAB",
  WNCAAB: "WNCAAB",
  MLB: "MLB",
  NCAABASEBALL: "NCAA Baseball",
  NFL: "NFL",
  CFL: "CFL",
  NCAAF: "NCAAF",
  NHL: "NHL",
  TENNIS: "TENNIS",
  SOCCER: "SOCCER",
  NRL: "NRL",
  GOLF: "GOLF",
  CRICKET: "CRICKET",
  MMA: "MMA",
};

/** Narrowing guard — useful when reading the (untyped) `sport` column. */
export function isSport(s: string | null | undefined): s is Sport {
  if (!s) return false;
  return (SPORT_ORDER as readonly string[]).includes(s);
}

/** Display label for a sport key (falls back to the key for unknown values). */
export function sportLabel(s: Sport | null | undefined): string {
  if (!s) return "";
  return SPORT_LABEL[s] ?? s;
}
