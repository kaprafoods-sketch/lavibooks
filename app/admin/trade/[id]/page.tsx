import Link from "next/link";
import { getCurrentRole } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase/server";
import { getPortfolioView } from "@/lib/portfolio-service";
import { OrderTicket } from "@/components/order-ticket";
import { Money } from "@/components/money";

export const dynamic = "force-dynamic";

export default async function AdminTradePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const role = await getCurrentRole();
  if (role !== "admin") {
    return (
      <div className="card mx-auto mt-12 max-w-md p-8 text-center">
        <h1 className="text-lg font-semibold">Admin</h1>
        <p className="mt-2 text-sm text-neutral-400">Administrators only.</p>
        <Link href="/command" className="btn-gold mt-5 inline-block">Back</Link>
      </div>
    );
  }

  const sb = await createServerSupabase();
  const { data: pf } = await sb
    .from("portfolios")
    .select("id, name, profiles!portfolios_owner_id_fkey(display_name)")
    .eq("id", id)
    .maybeSingle();

  if (!pf) {
    return (
      <div className="card mx-auto mt-12 max-w-md p-8 text-center">
        <h1 className="text-lg font-semibold">Portfolio not found</h1>
        <Link href="/admin" className="btn-gold mt-5 inline-block">Back to console</Link>
      </div>
    );
  }

  const owner = (pf.profiles as unknown as { display_name: string | null } | null)?.display_name ?? "investor";
  const view = await getPortfolioView(sb, id);
  const { data: instruments } = await sb.from("instruments").select("symbol").eq("is_active", true).order("symbol");
  const { data: recent } = await sb
    .from("orders")
    .select("side, type, qty, status, created_at, automated, instruments(symbol), trades(price_cents)")
    .eq("portfolio_id", id)
    .order("created_at", { ascending: false })
    .limit(12);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/admin" className="text-xs text-gold">← Admin console</Link>
          <h1 className="mt-1 text-lg font-semibold">Trade for {owner}</h1>
          <p className="text-xs text-neutral-500">Orders you place here execute in {owner}&apos;s portfolio and are recorded against your admin account.</p>
        </div>
        <div className="text-right">
          <div className="text-xs text-neutral-500">Cash / buying power</div>
          <div className="text-lg"><Money cents={view.cashCents} /></div>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_360px]">
        {/* Current positions (what you can add to or sell) */}
        <div className="card overflow-x-auto">
          <div className="border-b border-ink-600 px-4 py-3 text-sm font-medium text-neutral-300">{owner}&apos;s positions</div>
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
          {view.positions.length === 0 && <p className="px-4 py-8 text-center text-sm text-neutral-500">No open positions — place the first buy.</p>}

          <div className="border-t border-ink-600 px-4 py-3 text-xs font-medium text-neutral-500">Recent orders</div>
          <table className="w-full text-sm">
            <tbody>
              {(recent ?? []).map((o, i) => {
                const fill = (o.trades as unknown as { price_cents: number }[])?.[0];
                return (
                  <tr key={i} className="border-b border-ink-700/50">
                    <td className="px-4 py-1.5 text-xs text-neutral-500">{new Date(o.created_at).toLocaleString()}</td>
                    <td className={`px-4 py-1.5 ${o.side === "buy" ? "gain" : "loss"}`}>{o.side}</td>
                    <td className="px-4 py-1.5 font-medium">{(o.instruments as unknown as { symbol: string })?.symbol}</td>
                    <td className="num px-4 py-1.5 text-right">{Number(o.qty)}</td>
                    <td className="px-4 py-1.5 text-right">{fill ? <Money cents={fill.price_cents} /> : "—"}</td>
                    <td className="px-4 py-1.5 text-xs text-neutral-500">{o.automated ? "auto" : "admin/manual"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {(recent ?? []).length === 0 && <p className="px-4 py-6 text-center text-xs text-neutral-500">No orders yet.</p>}
        </div>

        {/* The order ticket, bound to this investor's portfolio */}
        <div>
          <div className="mb-2 rounded-lg border border-gold/30 bg-ink-900 p-3 text-xs text-neutral-300">
            Trading on behalf of <span className="font-medium text-neutral-100">{owner}</span>. Fills use the last cached price with slippage — virtual money only.
          </div>
          <OrderTicket portfolioId={id} symbols={(instruments ?? []).map((r) => r.symbol)} />
        </div>
      </div>
    </div>
  );
}
