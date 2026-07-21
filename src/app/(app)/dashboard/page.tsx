import { redirect } from "next/navigation";
import { loadShellContext } from "@/lib/active-system";
import DashboardView, {
  type DashboardSearchParams,
} from "@/components/DashboardView";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams>;
}) {
  const sp = await searchParams;
  const ctx = await loadShellContext();
  if (!ctx) redirect("/sign-in");
  if (!ctx.activeSystemId) redirect("/systems?first=1");
  return <DashboardView systemId={ctx.activeSystemId} sp={sp} />;
}
