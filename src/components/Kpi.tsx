import { cn } from "@/lib/utils";

interface Props {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "default" | "good" | "bad" | "accent";
  icon?: React.ReactNode;
  className?: string;
}

export default function Kpi({ label, value, sub, tone = "default", icon, className }: Props) {
  return (
    <div className={cn("panel p-4", className)}>
      <div className="flex items-center justify-between mb-1">
        <div className="kpi-label">{label}</div>
        {icon && <div className="text-ink-dim">{icon}</div>}
      </div>
      <div
        className={cn(
          "kpi-value font-mono",
          tone === "good" && "text-good",
          tone === "bad" && "text-bad",
          tone === "accent" && "text-accent",
        )}
      >
        {value}
      </div>
      {sub && <div className="text-xs text-ink-dim mt-1">{sub}</div>}
    </div>
  );
}
