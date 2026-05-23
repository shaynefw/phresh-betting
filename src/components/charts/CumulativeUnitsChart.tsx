"use client";

import {
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Area,
  ComposedChart,
} from "recharts";

export interface CumulativePoint {
  day: number;
  date: string;
  cumulativeUnits: number;
  trendline?: number | null;
}

interface Props {
  data: CumulativePoint[];
  scaleUpAt?: number;
  scaleDownAt?: number;
  height?: number;
  /**
   * X-axis title. Defaults to "Betting Days" — the dashboard passes a
   * timeframe-specific label ("Betting Weeks" / "Betting Months" /
   * "Betting Years") so the axis reads cleanly across views.
   */
  xAxisLabel?: string;
  /**
   * When true, the X-axis renders denser tick labels (smaller
   * minTickGap + preserveStartEnd) so Day/All views fill the axis
   * more evenly instead of skipping large stretches. Block-based views
   * (Week / Month / Year) already have few enough points that they
   * don't need this.
   */
  denseTicks?: boolean;
}

export default function CumulativeUnitsChart({
  data,
  scaleUpAt,
  scaleDownAt,
  height = 320,
  xAxisLabel = "Betting Days",
  denseTicks = false,
}: Props) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart
        data={data}
        // Bottom margin grows to fit the X-axis title; left margin
        // gives the vertical Y-axis title room.
        margin={{ top: 12, right: 12, left: 18, bottom: 24 }}
      >
        <defs>
          <linearGradient id="cumGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22a8ff" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#22a8ff" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#1a2540" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="day"
          type="number"
          domain={["dataMin", "dataMax"]}
          allowDecimals={false}
          tickLine={false}
          axisLine={{ stroke: "#1a2540" }}
          // Denser ticks for Day/All so labels fill the axis without
          // huge gaps. minTickGap caps per-pixel spacing; the
          // preserveStartEnd hint keeps the first + last tick visible.
          interval={denseTicks ? "preserveStartEnd" : "preserveEnd"}
          minTickGap={denseTicks ? 20 : 32}
          label={{
            value: xAxisLabel,
            position: "insideBottom",
            offset: -14,
            style: {
              fill: "#7280a0",
              fontSize: 11,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            },
          }}
        />
        <YAxis
          tickLine={false}
          axisLine={{ stroke: "#1a2540" }}
          width={56}
          label={{
            value: "Cumulative Units",
            angle: -90,
            position: "insideLeft",
            offset: 6,
            style: {
              fill: "#7280a0",
              fontSize: 11,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              textAnchor: "middle",
            },
          }}
        />
        <Tooltip
          formatter={(v: number) => `${v.toFixed(2)}u`}
          labelFormatter={(d, payload) => {
            const p = payload?.[0]?.payload as CumulativePoint | undefined;
            if (!p) return `Day ${d}`;
            // Imported baseline points have no calendar date; show only "Day N".
            return p.date && p.date !== "baseline"
              ? `Day ${p.day} • ${p.date}`
              : `Day ${p.day}`;
          }}
        />
        {typeof scaleUpAt === "number" && (
          <ReferenceLine
            y={scaleUpAt}
            stroke="#22a8ff"
            strokeDasharray="4 4"
            label={{ value: `Scale up @ +${scaleUpAt}u`, fill: "#a3b3d1", fontSize: 11, position: "insideTopLeft" }}
          />
        )}
        {typeof scaleDownAt === "number" && (
          <ReferenceLine
            y={scaleDownAt}
            stroke="#ef4444"
            strokeDasharray="4 4"
            label={{ value: `Scale down @ ${scaleDownAt}u`, fill: "#a3b3d1", fontSize: 11, position: "insideBottomLeft" }}
          />
        )}
        <ReferenceLine y={0} stroke="#243456" />
        <Area
          type="monotone"
          dataKey="cumulativeUnits"
          stroke="none"
          fill="url(#cumGrad)"
        />
        <Line
          type="monotone"
          dataKey="cumulativeUnits"
          stroke="#22a8ff"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, stroke: "#22a8ff", strokeWidth: 2, fill: "#0d1422" }}
        />
        <Line
          type="linear"
          dataKey="trendline"
          stroke="#d9d141"
          strokeWidth={2}
          dot={false}
          activeDot={false}
          isAnimationActive={false}
          connectNulls={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
