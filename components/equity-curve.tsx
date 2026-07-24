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
        <XAxis dataKey="d" tick={{ fontSize: 10, fill: "#9A9A9A" }} minTickGap={40} />
        <YAxis
          tick={{ fontSize: 10, fill: "#9A9A9A" }} width={64}
          domain={["auto", "auto"]}
          tickFormatter={(v) => `$${Math.round(v).toLocaleString()}`}
        />
        <Tooltip
          contentStyle={{ background: "#FFFFFF", border: "1px solid #E6E6E6", borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: "#6B6B6B" }}
          formatter={(v: number) => [`$${v.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, "Equity"]}
        />
        <Line type="monotone" dataKey="equity" stroke="#000000" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
