/**
 * Auth wrapper. In production this delegates to Clerk.
 * In local preview (`PREVIEW_MODE=1` in `.env.local`) it returns a fake
 * user so Claude can render every page in the preview Chrome without
 * going through Clerk's hosted account portal (which is blocked by the
 * preview sandbox's localhost-only policy).
 *
 * The bypass ONLY activates when `PREVIEW_MODE=1` is set as an env var.
 * It is never set in Vercel, so production stays Clerk-protected.
 */

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";

const PREVIEW_USER_ID = "preview_user_local";
const PREVIEW_EMAIL = "preview@local.dev";

export function isPreviewMode(): boolean {
  return process.env.PREVIEW_MODE === "1";
}

export async function getUserId(): Promise<string | null> {
  if (isPreviewMode()) return PREVIEW_USER_ID;
  const { auth } = await import("@clerk/nextjs/server");
  const { userId } = await auth();
  return userId ?? null;
}

export async function getUserEmail(): Promise<string> {
  if (isPreviewMode()) return PREVIEW_EMAIL;
  const { currentUser } = await import("@clerk/nextjs/server");
  const user = await currentUser();
  return user?.emailAddresses?.[0]?.emailAddress ?? "";
}

export async function requireUser(): Promise<string> {
  const userId = await getUserId();
  if (!userId) redirect("/sign-in");
  return userId;
}

/**
 * Verifies that `systemId` belongs to the current user. Throws if not.
 * Use this server-side before any read/write on system-scoped tables.
 */
export async function requireSystemAccess(systemId: string) {
  const userId = await requireUser();
  const sb = createAdminClient();
  const { data, error } = await sb
    .from("systems")
    .select("id")
    .eq("id", systemId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) {
    throw new Error("System not found or access denied");
  }
  return { userId, systemId };
}
