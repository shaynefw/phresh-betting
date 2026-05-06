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
