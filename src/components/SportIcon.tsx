"use client";

import type { Sport } from "@/lib/sports";
import type { ComponentType } from "react";

/**
 * Outlined sport icons matching the lucide-react aesthetic used elsewhere
 * in the app (24x24 viewBox, currentColor stroke, no fill, 1.75 stroke
 * width, round caps + joins).
 *
 * 10 distinct icons cover 14 leagues:
 *   - Basketball: NBA, WNBA, NCAAB, WNCAAB
 *   - Football (American): NFL, NCAAF
 *   - Baseball: MLB
 *   - Hockey puck: NHL
 *   - Tennis ball: TENNIS
 *   - Soccer ball: SOCCER
 *   - Rugby ball: NRL
 *   - Golf flag + ball: GOLF
 *   - Cricket bat + ball: CRICKET
 *   - Boxing glove: MMA
 */

interface SubProps {
  size: number;
  className?: string;
}

interface Props {
  sport: Sport;
  size?: number;
  className?: string;
}

const SIZE_DEFAULT = 14;

function baseProps(size: number, className?: string) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: "currentColor" as const,
    strokeWidth: 1.75 as const,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true as const,
    focusable: false as const,
  };
}

/* --------------------------------------------------------------- */
/* Individual icons                                                */
/* --------------------------------------------------------------- */

function Basketball({ size, className }: SubProps) {
  return (
    <svg {...baseProps(size, className)}>
      <circle cx="12" cy="12" r="9" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="12" y1="3" x2="12" y2="21" />
      <path d="M5.6 5.6 C9 9 15 9 18.4 5.6" />
      <path d="M5.6 18.4 C9 15 15 15 18.4 18.4" />
    </svg>
  );
}

function Baseball({ size, className }: SubProps) {
  return (
    <svg {...baseProps(size, className)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.5 7.5 C8 10 8 14 5.5 16.5" strokeDasharray="2 1.8" />
      <path d="M18.5 7.5 C16 10 16 14 18.5 16.5" strokeDasharray="2 1.8" />
    </svg>
  );
}

function Football({ size, className }: SubProps) {
  return (
    <svg {...baseProps(size, className)}>
      {/* football "lens" shape */}
      <path d="M3.5 12 Q12 4 20.5 12 Q12 20 3.5 12 Z" />
      <line x1="9" y1="12" x2="15" y2="12" />
      <line x1="10.5" y1="10.5" x2="10.5" y2="13.5" />
      <line x1="12" y1="10.2" x2="12" y2="13.8" />
      <line x1="13.5" y1="10.5" x2="13.5" y2="13.5" />
    </svg>
  );
}

function HockeyPuck({ size, className }: SubProps) {
  return (
    <svg {...baseProps(size, className)}>
      {/* top ellipse */}
      <ellipse cx="12" cy="9" rx="8" ry="2.5" />
      {/* sides */}
      <line x1="4" y1="9" x2="4" y2="14.5" />
      <line x1="20" y1="9" x2="20" y2="14.5" />
      {/* bottom rim */}
      <path d="M4 14.5 Q12 18 20 14.5" />
    </svg>
  );
}

function TennisBall({ size, className }: SubProps) {
  return (
    <svg {...baseProps(size, className)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M4 8.5 Q12 13 12 17 Q12 7 20 8.5" />
    </svg>
  );
}

function SoccerBall({ size, className }: SubProps) {
  return (
    <svg {...baseProps(size, className)}>
      <circle cx="12" cy="12" r="9" />
      {/* center pentagon */}
      <path d="M12 8.5 L15.2 10.8 L14 14.4 L10 14.4 L8.8 10.8 Z" />
      {/* spokes from pentagon to outer ring */}
      <line x1="12" y1="3" x2="12" y2="8.5" />
      <line x1="15.2" y1="10.8" x2="20.5" y2="9.5" />
      <line x1="14" y1="14.4" x2="17" y2="19.5" />
      <line x1="10" y1="14.4" x2="7" y2="19.5" />
      <line x1="8.8" y1="10.8" x2="3.5" y2="9.5" />
    </svg>
  );
}

function RugbyBall({ size, className }: SubProps) {
  return (
    <svg {...baseProps(size, className)}>
      {/* rugby "lens" same shape as football minus laces */}
      <path d="M3.5 12 Q12 4 20.5 12 Q12 20 3.5 12 Z" />
      <line x1="6.5" y1="12" x2="17.5" y2="12" />
    </svg>
  );
}

function GolfFlag({ size, className }: SubProps) {
  return (
    <svg {...baseProps(size, className)}>
      <line x1="6" y1="3.5" x2="6" y2="20" />
      <path d="M6 4 L16 7 L6 10 Z" />
      <line x1="3" y1="20" x2="21" y2="20" />
      <circle cx="14" cy="19" r="1.4" />
    </svg>
  );
}

function CricketBat({ size, className }: SubProps) {
  return (
    <svg {...baseProps(size, className)}>
      {/* handle */}
      <line x1="13" y1="3.5" x2="9" y2="8.5" />
      {/* bat blade — tilted */}
      <path d="M9 8.5 L4 14 L9 19 L14 14 Z" />
      {/* ball */}
      <circle cx="18.5" cy="18.5" r="1.6" />
    </svg>
  );
}

function BoxingGlove({ size, className }: SubProps) {
  return (
    <svg {...baseProps(size, className)}>
      {/* glove body */}
      <path d="M8 5.5 Q8 4 10 4 L14 4 Q18 4 18 8 L18 16 Q18 20.5 13 20.5 Q8 20.5 8 16 Z" />
      {/* thumb */}
      <path d="M8 10.5 Q5 11.5 5 13.5 Q5 15.5 8 15.5" />
      {/* knuckle line */}
      <line x1="9.5" y1="7.5" x2="16.5" y2="7.5" />
    </svg>
  );
}

/* --------------------------------------------------------------- */
/* Sport → component lookup                                        */
/* --------------------------------------------------------------- */

const ICONS: Record<Sport, ComponentType<SubProps>> = {
  NBA: Basketball,
  WNBA: Basketball,
  NCAAB: Basketball,
  WNCAAB: Basketball,
  MLB: Baseball,
  NFL: Football,
  NCAAF: Football,
  NHL: HockeyPuck,
  TENNIS: TennisBall,
  SOCCER: SoccerBall,
  NRL: RugbyBall,
  GOLF: GolfFlag,
  CRICKET: CricketBat,
  MMA: BoxingGlove,
};

export default function SportIcon({
  sport,
  size = SIZE_DEFAULT,
  className,
}: Props) {
  const Icon = ICONS[sport];
  return <Icon size={size} className={className} />;
}
