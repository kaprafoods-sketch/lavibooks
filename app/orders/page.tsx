import { getDefaultPortfolio } from "@/lib/auth";
import { Money } from "@/components/money";

export const dynamic = "force-dynamic";

const statusColor: Record<string, string> = {
  filled: "text-gain", rejected: "text-loss", cancelled: "text-neutral-500",
  pending: "text-gold", partial: "text-gold",
};

export default async function OrdersPage() {
  const { sb, user, portfolio } = await getDefaultPortfolio();
  if (!user || !portfolio) return <p className="text-sm text-neutral-400">Sign in and seed to view orders.</p>;

  const { data: orders } = await sb
    .from("orders")
    .select("id,side,type,qty,status,filled_qty,reject_reason,created_at,limit_price_cents,stop_price_cents,instruments(symbol),trades(price_cents)")
    .eq("portfolio_id", portfolio.id)
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <div className="card overflow-x-auto">
      <div className="border-b border-ink-600 px-4 py-3 text-sm font-medium text-neutral-300">Order history</div>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-neutral-500">
          <tr className="border-b border-ink-600">
            <th className="px-4 py-2 font-normal">When</th>
            <th className="px-4 py-2 font-normal">Symbol</th>
            <th className="px-4 py-2 font-normal">Side</th>
            <th className="px-4 py-2 font-normal">Type</th>
            <th className="px-4 py-2 text-right font-normal">Qty</th>
            <th className="px-4 py-2 text-right font-normal">Fill</th>
            <th className="px-4 py-2 font-normal">Status</th>
          </tr>
        </thead>
        <tbody>
          {(orders ?? []).map((o) => {
            const fill = (o.trades as unknown as { price_cents: number }[])?.[0];
            return (
              <tr key={o.id} className="border-b border-ink-700/50">
                <td className="px-4 py-2 text-xs text-neutral-500">{new Date(o.created_at).toLocaleString()}</td>
                <td className="px-4 py-2 font-medium">{(o.instruments as unknown as { symbol: string })?.symbol}</td>
                <td className={`px-4 py-2 ${o.side === "buy" ? "gain" : "loss"}`}>{o.side}</td>
                <td className="px-4 py-2 text-neutral-400">{o.type}</td>
                <td className="num px-4 py-2 text-right">{Number(o.qty)}</td>
                <td className="px-4 py-2 text-right">{fill ? <Money cents={fill.price_cents} /> : <span className="text-neutral-600">—</span>}</td>
                <td className={`px-4 py-2 ${statusColor[o.status]}`} title={o.reject_reason ?? ""}>{o.status}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {(orders ?? []).length === 0 && <p className="px-4 py-8 text-center text-sm text-neutral-500">No orders yet.</p>}
    </div>
  );
}
