import { redirect } from "next/navigation";
import Shell from "@/components/Shell";
import { loadShellContext } from "@/lib/active-system";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await loadShellContext();
  if (!ctx) redirect("/login");
  if (ctx.systems.length === 0) redirect("/systems?first=1");

  return (
    <Shell email={ctx.email} systems={ctx.systems} activeSystemId={ctx.activeSystemId}>
      {children}
    </Shell>
  );
}
