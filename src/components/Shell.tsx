"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import type { System } from "@/lib/types";
import {
  Settings2,
  BarChart3,
  BookOpen,
  Layers,
  Users,
  Menu,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  email: string;
  systems: System[];
  activeSystemId: string;
  children: React.ReactNode;
}

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: BarChart3 },
  { href: "/cappers", label: "Cappers", icon: Users },
  { href: "/journal", label: "Journal", icon: BookOpen },
  { href: "/scaling", label: "Scaling", icon: Layers },
  { href: "/settings", label: "Settings", icon: Settings2 },
];

export default function Shell({ email, systems, activeSystemId, children }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  function changeSystem(id: string) {
    document.cookie = `active_system=${id}; path=/; max-age=${60 * 60 * 24 * 365}`;
    router.refresh();
  }

  const activeSystem = systems.find((s) => s.id === activeSystemId);

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      {/* mobile top bar */}
      <header className="md:hidden sticky top-0 z-30 flex items-center justify-between px-3 py-2 border-b border-border bg-bg-panel/95 backdrop-blur">
        <button
          aria-label="Open menu"
          onClick={() => setOpen(true)}
          className="p-2 rounded-md hover:bg-bg-card"
        >
          <Menu className="h-5 w-5 text-ink" />
        </button>
        <div className="flex flex-col items-center leading-tight">
          <span className="text-[9px] tracking-[0.4em] text-accent uppercase">
            Phresh Mastery
          </span>
          <span className="text-xs text-ink-dim truncate max-w-[180px]">
            {activeSystem?.name ?? "—"}
          </span>
        </div>
        <UserButton />
      </header>

      {/* mobile drawer */}
      {open && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setOpen(false)}
          />
          <aside className="relative z-10 w-72 bg-bg-panel border-r border-border flex flex-col">
            <DrawerContents
              systems={systems}
              activeSystemId={activeSystemId}
              onChangeSystem={changeSystem}
              email={email}
              pathname={pathname}
              onClose={() => setOpen(false)}
            />
          </aside>
        </div>
      )}

      {/* desktop sidebar */}
      <aside className="hidden md:flex w-60 shrink-0 border-r border-border bg-bg-panel/60 flex-col">
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
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <Link
            href="/systems"
            className="block text-xs text-accent mt-2 hover:underline"
          >
            Manage systems →
          </Link>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {NAV.map((n) => {
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
        <div className="p-3 border-t border-border flex items-center gap-3">
          <UserButton />
          <div className="text-xs text-ink-dim truncate">{email}</div>
        </div>
      </aside>

      <main className="flex-1 min-w-0">{children}</main>

      {/* mobile bottom tab bar (always-visible nav) */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 grid grid-cols-5 border-t border-border bg-bg-panel/95 backdrop-blur">
        {NAV.map((n) => {
          const Active = pathname?.startsWith(n.href);
          const Icon = n.icon;
          return (
            <Link
              key={n.href}
              href={n.href}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] transition",
                Active ? "text-accent" : "text-ink-dim hover:text-ink",
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{n.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* spacer so bottom tab bar doesn't cover content */}
      <div className="h-16 md:hidden" />
    </div>
  );
}

function DrawerContents({
  systems,
  activeSystemId,
  onChangeSystem,
  email,
  pathname,
  onClose,
}: {
  systems: System[];
  activeSystemId: string;
  onChangeSystem: (id: string) => void;
  email: string;
  pathname: string | null;
  onClose: () => void;
}) {
  return (
    <>
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div>
          <div className="text-[10px] tracking-[0.4em] text-accent uppercase">
            Phresh Mastery
          </div>
          <div className="text-base font-semibold">Betting System</div>
        </div>
        <button
          aria-label="Close menu"
          onClick={onClose}
          className="p-2 rounded-md hover:bg-bg-card"
        >
          <X className="h-5 w-5 text-ink" />
        </button>
      </div>
      <div className="p-3 border-b border-border">
        <label className="label">Active system</label>
        <select
          className="input"
          value={activeSystemId}
          onChange={(e) => {
            onChangeSystem(e.target.value);
            onClose();
          }}
        >
          {systems.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <Link
          href="/systems"
          onClick={onClose}
          className="block text-xs text-accent mt-2 hover:underline"
        >
          Manage systems →
        </Link>
      </div>
      <nav className="flex-1 p-2 space-y-1">
        {NAV.map((n) => {
          const Active = pathname?.startsWith(n.href);
          const Icon = n.icon;
          return (
            <Link
              key={n.href}
              href={n.href}
              onClick={onClose}
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
      <div className="p-3 border-t border-border flex items-center gap-3">
        <UserButton />
        <div className="text-xs text-ink-dim truncate">{email}</div>
      </div>
    </>
  );
}
