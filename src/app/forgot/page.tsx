"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?type=recovery`,
    });
    setLoading(false);
    if (error) return setErr(error.message);
    setMsg("Reset email sent. Check your inbox.");
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <form onSubmit={submit} className="panel w-full max-w-sm p-6">
        <h1 className="text-2xl font-semibold mb-6">Reset password</h1>
        <label className="label">Email</label>
        <input className="input mb-4" type="email" required value={email}
               onChange={(e) => setEmail(e.target.value)} />
        {err && <p className="text-bad text-sm mb-3">{err}</p>}
        {msg && <p className="text-accent text-sm mb-3">{msg}</p>}
        <button className="btn-primary w-full" disabled={loading}>
          {loading ? "Sending..." : "Send reset email"}
        </button>
        <div className="text-xs text-ink-dim mt-4 text-center">
          <Link href="/login" className="hover:text-accent">Back to sign in</Link>
        </div>
      </form>
    </main>
  );
}
