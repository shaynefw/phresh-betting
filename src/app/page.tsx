import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function Landing() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6">
      <div className="max-w-xl text-center">
        <div className="text-[11px] tracking-[0.4em] text-accent uppercase mb-3">
          Phresh Mastery
        </div>
        <h1 className="text-5xl font-bold mb-4 leading-tight">
          Sports Betting <span className="text-accent">Command Center</span>
        </h1>
        <p className="text-ink-dim mb-8">
          Track multiple systems, multiple cappers, scaling logic, and a fully
          synced daily journal — built for serious operators.
        </p>
        <div className="flex gap-3 justify-center">
          <Link href="/signup" className="btn-primary">
            Create account
          </Link>
          <Link href="/login" className="btn-ghost">
            Sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
