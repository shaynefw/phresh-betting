"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/dashboard";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setErr(error.message);
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <form onSubmit={submit} className="panel w-full max-w-sm p-6">
        <div className="text-[11px] tracking-[0.4em] text-accent uppercase mb-2">
          Phresh Mastery
        </div>
        <h1 className="text-2xl font-semibold mb-6">Sign in</h1>
        <label className="label">Email</label>
        <input className="input mb-3" type="email" required value={email}
               onChange={(e) => setEmail(e.target.value)} />
        <label className="label">Password</label>
        <input className="input mb-4" type="password" required value={password}
               onChange={(e) => setPassword(e.target.value)} />
        {err && <p className="text-bad text-sm mb-3">{err}</p>}
        <button className="btn-primary w-full" disabled={loading}>
          {loading ? "Signing in..." : "Sign in"}
        </button>
        <div className="flex justify-between text-xs text-ink-dim mt-4">
          <Link href="/signup" className="hover:text-accent">Create account</Link>
          <Link href="/forgot" className="hover:text-accent">Forgot password</Link>
        </div>
      </form>
    </main>
  );
}
