"use client";

/** Tiny inline SVG sparkline — no library, no axis. Colored by net direction. */
export function Sparkline({
  data,
  width = 84,
  height = 22,
}: {
  data: number[];
  width?: number;
  height?: number;
}) {
  if (!data || data.length < 2) {
    return <span className="t-label" style={{ opacity: 0.4 }}>—</span>;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const dx = width / (data.length - 1);
  const pts = data.map((v, i) => {
    const x = i * dx;
    const y = height - ((v - min) / span) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const up = data[data.length - 1] >= data[0];
  const stroke = up ? "var(--t-gain)" : "var(--t-loss)";
  return (
    <svg width={width} height={height} style={{ display: "block" }} aria-hidden>
      <polyline points={pts.join(" ")} fill="none" stroke={stroke} strokeWidth={1.25} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
