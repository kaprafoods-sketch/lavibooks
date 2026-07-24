import Link from "next/link";
import { getDefaultPortfolio } from "@/lib/auth";
import { OrderTicket } from "@/components/order-ticket";
import { Money } from "@/components/money";

export const dynamic = "force-dynamic";

export default async function TradePage() {
  const { sb, user, portfolio } = await getDefaultPortfolio();
  if (!user) return <p className="text-sm text-neutral-400">Please <Link href="/login" className="text-gold">sign in</Link>.</p>;
  if (!portfolio) return <p className="text-sm text-neutral-400">No portfolio — run <code>pnpm seed</code>.</p>;

  // Tradable instruments (those with a cached price).
  const { data: instruments } = await sb
    .from("instruments")
    .select("symbol,name,price_cache(last_price_cents,is_delayed,fetched_at)")
    .eq("is_active", true)
    .order("symbol");

  const rows = (instruments ?? []).map((i) => ({
    symbol: i.symbol,
    name: i.name as string | null,
    price: (i.price_cache as unknown as { last_price_cents: number; is_delayed: boolean; fetched_at: string }[])?.[0],
  }));

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_360px]">
      <div className="card overflow-hidden">
        <div className="border-b border-ink-600 px-4 py-3 text-sm font-medium text-neutral-300">
          Instruments
        </div>
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol} className="border-b border-ink-700/50">
                <td className="px-4 py-2">
                  <div className="font-medium text-neutral-100">{r.symbol}</div>
                  <div className="text-xs text-neutral-500">{r.name}</div>
                </td>
                <td className="px-4 py-2 text-right">
                  {r.price ? <Money cents={r.price.last_price_cents} /> : <span className="text-neutral-600">—</span>}
                  {r.price?.is_delayed && <div className="text-[10px] text-gold">delayed</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-neutral-500">
            No instruments cached yet. Run the seed + quote refresh.
          </p>
        )}
      </div>

      <OrderTicket portfolioId={portfolio.id} symbols={rows.map((r) => r.symbol)} />
    </div>
  );
}
