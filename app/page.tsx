import Link from "next/link";
import { getDefaultPortfolio } from "@/lib/auth";
import { getPortfolioView } from "@/lib/portfolio-service";
import { Money, Pct } from "@/components/money";
import { EquityCurve } from "@/components/equity-curve";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const { sb, user, portfolio } = await getDefaultPortfolio();

  if (!user) {
    return (
      <EmptyState
        title="Welcome to Lavi Books"
        body="Sign in to get $100,000 of virtual cash and start paper trading."
        href="/login" cta="Sign in"
      />
    );
  }
  if (!portfolio) {
    return (
      <EmptyState
        title="No portfolio yet"
        body="Run the seed script (pnpm seed) or create a portfolio to begin."
        href="/trade" cta="Go to Trade"
      />
    );
  }

  const view = await getPortfolioView(sb, portfolio.id);
  const { data: snaps } = await sb
    .from("snapshots").select("d,equity_cents").eq("portfolio_id", portfolio.id)
    .order("d", { ascending: true });

  const startEquity = snaps?.[0]?.equity_cents ?? view.equityCents;
  const totalPnl = view.equityCents - startEquity;
  const totalPct = startEquity ? (totalPnl / startEquity) * 100 : 0;
  const anyDelayed = view.positions.some((p) => p.isDelayed);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Equity"><Money cents={view.equityCents} /></Stat>
        <Stat label="Cash"><Money cents={view.cashCents} /></Stat>
        <Stat label="Unrealized P&L"><Money cents={view.unrealizedPnlCents} colored showSign /></Stat>
        <Stat label="Total return"><Pct value={totalPct} /></Stat>
      </div>

      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-neutral-300">Equity curve</h2>
          <span className="text-xs text-neutral-600">EOD snapshots</span>
        </div>
        <EquityCurve data={(snaps ?? []).map((s) => ({ d: s.d, equity: s.equity_cents / 100 }))} />
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-ink-600 px-4 py-3">
          <h2 className="text-sm font-medium text-neutral-300">Positions</h2>
          {anyDelayed && <span className="rounded bg-ink-700 px-2 py-0.5 text-[10px] text-gold">DELAYED QUOTES</span>}
        </div>
        {view.positions.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-neutral-500">
            No open positions. <Link href="/trade" className="text-gold">Place your first trade →</Link>
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-neutral-500">
              <tr className="border-b border-ink-600">
                <th className="px-4 py-2 font-normal">Symbol</th>
                <th className="px-4 py-2 text-right font-normal">Qty</th>
                <th className="px-4 py-2 text-right font-normal">Avg cost</th>
                <th className="px-4 py-2 text-right font-normal">Mark</th>
                <th className="px-4 py-2 text-right font-normal">Value</th>
                <th className="px-4 py-2 text-right font-normal">Unrl. P&L</th>
              </tr>
            </thead>
            <tbody>
              {view.positions.map((p) => (
                <tr key={p.instrumentId} className="border-b border-ink-700/50">
                  <td className="px-4 py-2 font-medium text-neutral-100">{p.symbol}</td>
                  <td className="num px-4 py-2 text-right">{p.qty}</td>
                  <td className="px-4 py-2 text-right"><Money cents={p.avgCostCents} /></td>
                  <td className="px-4 py-2 text-right"><Money cents={p.markCents} /></td>
                  <td className="px-4 py-2 text-right"><Money cents={p.marketValueCents} /></td>
                  <td className="px-4 py-2 text-right"><Money cents={p.unrealizedPnlCents} colored showSign /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="card p-3">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-1 text-lg">{children}</div>
    </div>
  );
}

function EmptyState({ title, body, href, cta }: { title: string; body: string; href: string; cta: string }) {
  return (
    <div className="card mx-auto mt-12 max-w-md p-8 text-center">
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-neutral-400">{body}</p>
      <Link href={href} className="btn-gold mt-5 inline-block">{cta}</Link>
    </div>
  );
}
