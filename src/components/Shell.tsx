"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { System } from "@/lib/types";
import { LogOut, Settings2, BarChart3, BookOpen, Layers, Users } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  email: string;
  systems: System[];
  activeSystemId: string;
  children: React.ReactNode;
}

export default function Shell({ email, systems, activeSystemId, children }: Props) {
  const pathname = usePathname();
  const router = useRouter();

  async function changeSystem(id: string) {
    document.cookie = `active_system=${id}; path=/; max-age=${60 * 60 * 24 * 365}`;
    router.refresh();
  }

  async function signOut() {
    const sb = createClient();
    await sb.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const nav = [
    { href: "/dashboard", label: "Dashboard", icon: BarChart3 },
    { href: "/cappers", label: "Cappers", icon: Users },
    { href: "/journal", label: "Journal", icon: BookOpen },
    { href: "/scaling", label: "Scaling Log", icon: Layers },
    { href: "/settings", label: "Settings", icon: Settings2 },
  ];

  return (
    <div className="min-h-screen flex">
      <aside className="w-60 shrink-0 border-r border-border bg-bg-panel/60 flex flex-col">
        <div className="p-4 border-b border-border">
          <div className="text-[10px] tracking-[0.4em] text-accent uppercase">
            Phresh Mastery
          </div>
          <div className="text-base font-semibold">Betting System</div>
        </div>
        <div className="p-3 border-b border-border">
          <label className="label">Active system</label>
          <select
            className="input"
            value={activeSystemId}
            onChange={(e) => changeSystem(e.target.value)}
          >
            {systems.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <Link href="/systems" className="block text-xs text-accent mt-2 hover:underline">
            Manage systems →
          </Link>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {nav.map((n) => {
            const Active = pathname?.startsWith(n.href);
            const Icon = n.icon;
            return (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-md text-sm transition",
                  Active
                    ? "bg-accent/10 text-accent border border-accent/30"
                    : "text-ink-dim hover:text-ink hover:bg-bg-card",
                )}
              >
                <Icon className="h-4 w-4" />
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-border text-xs">
          <div className="text-ink-dim truncate mb-2">{email}</div>
          <button onClick={signOut} className="btn-ghost w-full">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
