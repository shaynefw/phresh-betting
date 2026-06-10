/**
 * PM monogram — the brand mark used in the sidebar and on either
 * side of the dashboard banner. Renders the letters "PM" in the
 * accent blue inside a shield outline that matches the reference
 * banner art.
 *
 *   variant="shield"  → shield outline + PM letters (banner badges)
 *   variant="plain"   → just the PM letters (compact sidebar mark)
 */

import { cn } from "@/lib/utils";

interface Props {
  className?: string;
  variant?: "shield" | "plain";
  title?: string;
}

export default function PmLogo({
  className,
  variant = "shield",
  title = "Phresh Mastery",
}: Props) {
  if (variant === "plain") {
    return (
      <svg
        viewBox="0 0 64 64"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label={title}
        className={cn("block", className)}
      >
        <title>{title}</title>
        <text
          x="32"
          y="44"
          textAnchor="middle"
          fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"
          fontWeight="900"
          fontSize="36"
          fill="#22a8ff"
          letterSpacing="-1"
        >
          PM
        </text>
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 96 112"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
      className={cn("block", className)}
    >
      <title>{title}</title>
      <defs>
        <linearGradient id="pm-shield-stroke" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#e7f3ff" />
          <stop offset="100%" stopColor="#22a8ff" />
        </linearGradient>
        <linearGradient id="pm-letters" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#e7f3ff" />
          <stop offset="100%" stopColor="#22a8ff" />
        </linearGradient>
      </defs>
      {/* Shield outline — top edge flat with rounded corners, bottom
          tapering to a soft point, mirrors the reference banner art. */}
      <path
        d="M14 10
           Q14 4 20 4
           H76
           Q82 4 82 10
           V58
           Q82 82 48 106
           Q14 82 14 58
           Z"
        fill="none"
        stroke="url(#pm-shield-stroke)"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      {/* PM monogram, centered inside the shield's safe area. */}
      <text
        x="48"
        y="62"
        textAnchor="middle"
        fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"
        fontWeight="900"
        fontSize="40"
        fill="url(#pm-letters)"
        letterSpacing="-1.5"
      >
        PM
      </text>
    </svg>
  );
}
