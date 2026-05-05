"use client";

import {
  LineChart,
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
}

export default function CumulativeUnitsChart({
  data,
  scaleUpAt,
  scaleDownAt,
  height = 320,
}: Props) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 12, right: 12, left: 4, bottom: 8 }}>
        <defs>
          <linearGradient id="cumGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22a8ff" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#22a8ff" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#1a2540" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="day" tickLine={false} axisLine={{ stroke: "#1a2540" }} />
        <YAxis tickLine={false} axisLine={{ stroke: "#1a2540" }} width={36} />
        <Tooltip
          formatter={(v: number) => `${v.toFixed(2)}u`}
          labelFormatter={(d, payload) => {
            const p = payload?.[0]?.payload as CumulativePoint | undefined;
            return p ? `Day ${p.day} • ${p.date}` : `Day ${d}`;
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
          type="monotone"
          dataKey="trendline"
          stroke="#f59e0b"
          strokeWidth={1.5}
          dot={false}
          strokeDasharray="2 4"
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
