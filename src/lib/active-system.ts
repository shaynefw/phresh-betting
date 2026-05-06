import { cookies } from "next/headers";
import { auth, currentUser } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { System } from "@/lib/types";

export async function loadShellContext(): Promise<{
  email: string;
  userId: string;
  systems: System[];
  activeSystemId: string;
} | null> {
  const { userId } = await auth();
  if (!userId) return null;

  const sb = createAdminClient();
  const { data: systems } = await sb
    .from("systems")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  const list = (systems ?? []) as System[];
  const cookieStore = await cookies();
  let active = cookieStore.get("active_system")?.value;
  if (!active || !list.find((s) => s.id === active)) {
    active = list[0]?.id ?? "";
  }

  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? "";

  return { email, userId, systems: list, activeSystemId: active };
}
