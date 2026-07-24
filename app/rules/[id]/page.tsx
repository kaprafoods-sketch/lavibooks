import Link from "next/link";
import { getDefaultPortfolio } from "@/lib/auth";
import { ruleSummary } from "@/lib/rules/summary";
import { backtestRule } from "@/lib/rules/backtest";
import { Money } from "@/components/money";
import type { Bar } from "@/lib/types";

export const dynamic = "force-dynamic";

const decisionColor: Record<string, string> = {
  triggered: "text-gold", no_trigger: "text-neutral-500", blocked: "text-loss",
};

export default async function RuleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { sb, user, portfolio } = await getDefaultPortfolio();
  if (!user || !portfolio) return <p className="text-sm text-neutral-400">Sign in to view this rule.</p>;

  const { data: rule } = await sb.from("rules").select("*,instruments(symbol,id)").eq("id", id).maybeSingle();
  if (!rule) return <p className="text-sm text-neutral-400">Rule not found.</p>;
  const symbol = (rule.instruments as unknown as { symbol: string; id: string })?.symbol ?? "—";
  const instrumentId = (rule.instruments as unknown as { id: string })?.id;

  const { data: events } = await sb.from("rule_events")
    .select("*,orders(id)").eq("rule_id", id).order("evaluated_at", { ascending: false }).limit(100);

  // Rule backtester over seeded daily bars.
  let bt: ReturnType<typeof backtestRule> | null = null;
  if (instrumentId) {
    const { data: barRows } = await sb.from("daily_bars")
      .select("d,open_cents,high_cents,low_cents,close_cents,volume")
      .eq("instrument_id", instrumentId).order("d", { ascending: true });
    if (barRows && barRows.length > 5) {
      const bars: Bar[] = barRows.map((b) => ({ d: b.d, openCents: b.open_cents, highCents: b.high_cents, lowCents: b.low_cents, closeCents: b.close_cents, volume: Number(b.volume ?? 0) }));
      const qty = (rule.params as { qty?: number }).qty ?? 1;
      bt = backtestRule(rule.type, rule.params, bars, qty, rule.entry_price_cents ?? undefined);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/rules" className="text-xs text-gold">← All rules</Link>
        <h1 className="mt-1 text-lg font-semibold">{symbol} · {rule.type.replace("_", " ")}</h1>
        <p className="text-sm text-neutral-300">{ruleSummary(rule.type, rule.params, symbol, rule.valid_until)}</p>
      </div>

      {bt && (
        <div className="card p-4">
          <h2 className="mb-3 text-sm font-medium text-neutral-300">Backtest (daily bars)</h2>
          {bt.smallSample && (
            <div className="mb-3 rounded border border-gold/40 bg-gold/10 p-2 text-xs text-gold">
              ⚠ Small sample: only {bt.triggerCount} triggers. Under 20, these stats mean little.
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Triggers" value={String(bt.triggerCount)} />
            <Metric label="Win rate" value={`${bt.winRatePct.toFixed(0)}%`} />
            <Metric label="Avg gain" cents={bt.avgGainCents} />
            <Metric label="Avg loss" cents={bt.avgLossCents} />
            <Metric label="Max drawdown" value={`-${bt.maxDrawdownPct.toFixed(1)}%`} />
          </div>
          {bt.triggerDates.length > 0 && (
            <p className="mt-3 text-xs text-neutral-500">Would have fired on: {bt.triggerDates.slice(0, 12).join(", ")}{bt.triggerDates.length > 12 ? "…" : ""}</p>
          )}
        </div>
      )}

      <div className="card overflow-x-auto">
        <div className="border-b border-ink-600 px-4 py-3 text-sm font-medium text-neutral-300">Event log (append-only)</div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-neutral-500">
            <tr className="border-b border-ink-600">
              <th className="px-4 py-2 font-normal">When</th>
              <th className="px-4 py-2 font-normal">Decision</th>
              <th className="px-4 py-2 text-right font-normal">Price</th>
              <th className="px-4 py-2 font-normal">Reason</th>
            </tr>
          </thead>
          <tbody>
            {(events ?? []).map((e) => (
              <tr key={e.id} className="border-b border-ink-700/50">
                <td className="px-4 py-2 text-xs text-neutral-500">{new Date(e.evaluated_at).toLocaleString()}</td>
                <td className={`px-4 py-2 ${decisionColor[e.decision]}`}>{e.decision}{e.price_is_stale ? " (stale)" : ""}</td>
                <td className="px-4 py-2 text-right">{e.market_price_cents ? <Money cents={e.market_price_cents} /> : "—"}</td>
                <td className="px-4 py-2 text-xs text-neutral-400">{e.reason_text}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(events ?? []).length === 0 && <p className="px-4 py-8 text-center text-sm text-neutral-500">No evaluations yet. Arm the rule and wait for the worker.</p>}
      </div>
    </div>
  );
}

function Metric({ label, value, cents }: { label: string; value?: string; cents?: number }) {
  return (
    <div className="card p-3">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="num mt-1 text-base">{cents != null ? <Money cents={cents} colored /> : value}</div>
    </div>
  );
}
