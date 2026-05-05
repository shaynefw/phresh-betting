"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    setMsg(null);
    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    setLoading(false);
    if (error) return setErr(error.message);
    if (data.session) {
      router.push("/dashboard");
      router.refresh();
    } else {
      setMsg("Check your email to confirm your account, then sign in.");
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <form onSubmit={submit} className="panel w-full max-w-sm p-6">
        <div className="text-[11px] tracking-[0.4em] text-accent uppercase mb-2">
          Phresh Mastery
        </div>
        <h1 className="text-2xl font-semibold mb-6">Create account</h1>
        <label className="label">Email</label>
        <input className="input mb-3" type="email" required value={email}
               onChange={(e) => setEmail(e.target.value)} />
        <label className="label">Password</label>
        <input className="input mb-4" type="password" required minLength={6} value={password}
               onChange={(e) => setPassword(e.target.value)} />
        {err && <p className="text-bad text-sm mb-3">{err}</p>}
        {msg && <p className="text-accent text-sm mb-3">{msg}</p>}
        <button className="btn-primary w-full" disabled={loading}>
          {loading ? "Creating..." : "Create account"}
        </button>
        <div className="text-xs text-ink-dim mt-4 text-center">
          Already have one? <Link href="/login" className="text-accent">Sign in</Link>
        </div>
      </form>
    </main>
  );
}
