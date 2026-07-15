import { createClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client using the service role key.
 * Bypasses RLS — must only be called from server code (server components,
 * server actions, route handlers, middleware-adjacent code).
 *
 * Always filter by userId from Clerk's `auth()` before returning rows
 * scoped to a user.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/**
 * PostgREST (and therefore supabase-js `.select()`) caps every response
 * at 1000 rows by default. A plain `.select("*")` on a table that has
 * grown past 1000 rows silently returns only the first page — which
 * for an ORDER BY date ascending fetch means the NEWEST rows go
 * missing. That's a data-integrity landmine for any system-wide fetch
 * (capper_day_entries, capper_bet_entries, journal_day_entries…).
 *
 * `fetchAllRows` pages through the full result set in 1000-row chunks
 * using `.range()` and concatenates them, so callers get every row
 * regardless of table size.
 *
 * The `makeQuery` factory MUST apply a deterministic `.order(...)` (any
 * stable key) so pages don't overlap or skip rows between requests.
 * Pass a factory (not a prebuilt query) because a PostgREST builder is
 * single-use once awaited.
 *
 * Example:
 *   const days = await fetchAllRows<CapperDayEntry>(() =>
 *     supabase.from("capper_day_entries")
 *       .select("*").eq("system_id", sysId).order("date"),
 *   );
 */
const PAGE_SIZE = 1000;

interface Rangeable<T> {
  range(
    from: number,
    to: number,
  ): PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
}

export async function fetchAllRows<T>(
  makeQuery: () => Rangeable<T>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await makeQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    out.push(...batch);
    // A short page means we've reached the end. (An exactly-full final
    // page triggers one extra empty request, which is harmless.)
    if (batch.length < PAGE_SIZE) break;
  }
  return out;
}
