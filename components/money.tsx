import { fmtCents } from "@/lib/money";

/** Money figure with tabular numerals and consistent gain/loss coloring. */
export function Money({
  cents,
  colored = false,
  showSign = false,
}: {
  cents: number;
  colored?: boolean;
  showSign?: boolean;
}) {
  const cls = colored ? (cents > 0 ? "gain" : cents < 0 ? "loss" : "") : "";
  const sign = showSign && cents > 0 ? "+" : "";
  return <span className={`num ${cls}`}>{sign}{fmtCents(cents)}</span>;
}

export function Pct({ value }: { value: number }) {
  const cls = value > 0 ? "gain" : value < 0 ? "loss" : "";
  const sign = value > 0 ? "+" : "";
  return <span className={`num ${cls}`}>{sign}{value.toFixed(2)}%</span>;
}
