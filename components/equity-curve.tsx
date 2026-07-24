"use client";

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

/** EOD equity curve. Champagne-gold line on the dark surface. */
export function EquityCurve({ data }: { data: { d: string; equity: number }[] }) {
  if (data.length < 2) {
    return <p className="py-10 text-center text-sm text-neutral-600">Equity curve appears after the first EOD snapshot.</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 5, right: 8, bottom: 0, left: 8 }}>
        <XAxis dataKey="d" tick={{ fontSize: 10, fill: "#6b6b76" }} minTickGap={40} />
        <YAxis
          tick={{ fontSize: 10, fill: "#6b6b76" }} width={64}
          domain={["auto", "auto"]}
          tickFormatter={(v) => `$${Math.round(v).toLocaleString()}`}
        />
        <Tooltip
          contentStyle={{ background: "#121216", border: "1px solid #22222b", borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: "#a3a3ad" }}
          formatter={(v: number) => [`$${v.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, "Equity"]}
        />
        <Line type="monotone" dataKey="equity" stroke="#c9a86a" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
