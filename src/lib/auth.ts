import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";

export async function requireUser() {
  const { userId } = await auth();
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
