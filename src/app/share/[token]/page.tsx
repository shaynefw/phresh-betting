import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import type { System } from "@/lib/types";
import DashboardView, {
  type DashboardSearchParams,
} from "@/components/DashboardView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Public, read-only view of a betting system.
 *
 * Reached at /share/<share_token>?timeframe=…&date=… — the same
 * DashboardView the owner sees, minus the date-picker + PNG-export
 * header controls. Timeframe tabs and the period calendar remain fully
 * navigable (they're pure navigation, not mutation). The token is
 * resolved server-side; a missing or revoked (null) token 404s. No
 * auth, no cookies, noindex.
 */
export default async function SharePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<DashboardSearchParams>;
}) {
  const { token } = await params;
  if (!token) notFound();
  const sp = await searchParams;

  const supabase = createAdminClient();
  const { data: sys } = await supabase
    .from("systems")
    .select("id")
    .eq("share_token", token)
    .maybeSingle();
  const system = sys as Pick<System, "id"> | null;
  if (!system) notFound();

  return (
    <div className="min-h-screen">
      <div className="max-w-6xl mx-auto">
        <DashboardView systemId={system.id} sp={sp} readOnly />
      </div>
    </div>
  );
}
