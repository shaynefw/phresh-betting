import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { System } from "@/lib/types";

export async function loadShellContext(): Promise<{
  email: string;
  systems: System[];
  activeSystemId: string;
} | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: systems } = await supabase
    .from("systems")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  const list = (systems ?? []) as System[];
  const cookieStore = cookies();
  let active = cookieStore.get("active_system")?.value;
  if (!active || !list.find((s) => s.id === active)) {
    active = list[0]?.id ?? "";
  }

  return {
    email: user.email ?? "",
    systems: list,
    activeSystemId: active,
  };
}
