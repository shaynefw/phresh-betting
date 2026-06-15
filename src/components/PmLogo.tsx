/**
 * PM Diamond Logo — the brand mark used in the sidebar and on either
 * side of the dashboard banner. The image lives at /public/pm-logo.png
 * (sourced from the user). Aspect ratio is ~0.84:1 (tall, because the
 * diamond sits above the circle), so callers should set a height with
 * Tailwind and let width auto-derive (`h-X w-auto`).
 *
 * The `variant` prop is preserved for API compatibility with the prior
 * SVG component, but both variants now render the same image.
 */
import Image from "next/image";
import { cn } from "@/lib/utils";

interface Props {
  className?: string;
  variant?: "shield" | "plain";
  title?: string;
  /** Hint to next/image for prioritization. Use on above-the-fold banner badges. */
  priority?: boolean;
}

export default function PmLogo({
  className,
  title = "Phresh Mastery",
  priority = false,
}: Props) {
  return (
    <Image
      src="/pm-logo.png"
      alt={title}
      width={1149}
      height={1369}
      priority={priority}
      className={cn("block w-auto h-auto select-none", className)}
      draggable={false}
    />
  );
}
