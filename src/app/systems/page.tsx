import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { System } from "@/lib/types";

async function createSystem(formData: FormData) {
  "use server";
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const name = String(formData.get("name") || "").trim();
  const description = String(formData.get("description") || "").trim();
  if (!name) return;
  const sb = createAdminClient();
  const { data, error } = await sb
    .from("systems")
    .insert({ user_id: userId, name, description: description || null })
    .select("*")
    .single();
  if (error || !data) return;

  await sb.from("scaling_log_entries").insert({
    system_id: data.id,
    effective_date: new Date().toISOString().slice(0, 10),
    starting_units_threshold: 0,
    ending_units_threshold: 25,
    unit_size_dollars: 25,
    notes: "Initial unit size",
  });

  const cookieStore = await cookies();
  cookieStore.set("active_system", data.id, { path: "/" });
  revalidatePath("/", "layout");
  redirect("/dashboard");
}

async function archiveSystem(formData: FormData) {
  "use server";
  const { userId } = await auth();
  if (!userId) return;
  const id = String(formData.get("id"));
  const sb = createAdminClient();
  await sb.from("systems").update({ archived: true }).eq("id", id).eq("user_id", userId);
  revalidatePath("/systems");
}

async function deleteSystem(formData: FormData) {
  "use server";
  const { userId } = await auth();
  if (!userId) return;
  const id = String(formData.get("id"));
  const sb = createAdminClient();
  await sb.from("systems").delete().eq("id", id).eq("user_id", userId);
  revalidatePath("/systems");
}

export default async function SystemsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const sb = createAdminClient();
  const { data } = await sb
    .from("systems")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  const systems = (data ?? []) as System[];

  return (
    <main className="min-h-screen p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="text-[10px] tracking-[0.4em] text-accent uppercase">Systems</div>
          <h1 className="text-2xl font-bold">Manage your betting systems</h1>
        </div>
        <Link href="/dashboard" className="btn-ghost">Back to dashboard</Link>
      </div>

      <form action={createSystem} className="panel p-5 mb-8">
        <h2 className="font-semibold mb-3">Create system</h2>
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <label className="label">Name</label>
            <input name="name" required className="input" placeholder="Main Betting System" />
          </div>
          <div>
            <label className="label">Description</label>
            <input name="description" className="input" placeholder="optional" />
          </div>
        </div>
        <div className="mt-3">
          <button className="btn-primary">Create</button>
        </div>
      </form>

      <div className="panel p-5">
        <h2 className="font-semibold mb-3">Existing</h2>
        {systems.length === 0 && (
          <p className="text-ink-dim text-sm">No systems yet.</p>
        )}
        <div className="divide-y divide-border">
          {systems.map((s) => (
            <div key={s.id} className="py-3 flex items-center justify-between">
              <div>
                <div className="font-medium">{s.name}</div>
                {s.description && (
                  <div className="text-xs text-ink-dim">{s.description}</div>
                )}
                {s.archived && <span className="pill-mute mt-1">archived</span>}
              </div>
              <div className="flex items-center gap-2">
                <form action={archiveSystem}>
                  <input type="hidden" name="id" value={s.id} />
                  <button className="btn-ghost text-xs">Archive</button>
                </form>
                <form action={deleteSystem}>
                  <input type="hidden" name="id" value={s.id} />
                  <button className="btn-danger text-xs">Delete</button>
                </form>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
