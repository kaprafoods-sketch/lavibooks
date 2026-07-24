import Link from "next/link";
import { getCurrentRole } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase/server";
import { getPortfolioView } from "@/lib/portfolio-service";
import { Money, Pct } from "@/components/money";
import { fmtCents } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const role = await getCurrentRole();
  if (role !== "admin") {
    return (
      <div className="card mx-auto mt-12 max-w-md p-8 text-center">
        <h1 className="text-lg font-semibold">Admin</h1>
        <p className="mt-2 text-sm text-neutral-400">This area is for administrators only.</p>
        <Link href="/command" className="btn-gold mt-5 inline-block">Back to your dashboard</Link>
      </div>
    );
  }

  const sb = await createServerSupabase();

  // All investor portfolios (admin RLS lets us read across owners).
  const { data: pfs } = await sb
    .from("portfolios")
    .select("id, name, created_at, profiles!portfolios_owner_id_fkey(display_name, role)")
    .eq("kind", "manual")
    .order("created_at", { ascending: true });

  const investors = await Promise.all(
    (pfs ?? []).map(async (pf) => {
      const v = await getPortfolioView(sb, pf.id);
      const prof = pf.profiles as unknown as { display_name: string | null; role: string } | null;
      return {
        id: pf.id,
        name: pf.name as string,
        owner: prof?.display_name ?? "—",
        role: prof?.role ?? "investor",
        equity: v.equityCents,
        cash: v.cashCents,
        positions: v.positions.length,
        unrl: v.unrealizedPnlCents,
      };
    }),
  );
  const totalAum = investors.reduce((a, i) => a + i.equity, 0);

  // Market (Finnhub) overview — query the tables directly (PostgREST embeds are
  // finicky here) and join in JS, exactly like the portfolio read path does.
  const [{ data: insts }, { data: prices }, { data: funds }] = await Promise.all([
    sb.from("instruments").select("id, symbol, name").eq("is_active", true).order("symbol"),
    sb.from("price_cache").select("instrument_id, last_price_cents, prev_close_cents, is_delayed"),
    sb.from("fundamentals_cache").select("instrument_id, sector, pe, beta, market_cap_cents"),
  ]);
  const priceBy = new Map((prices ?? []).map((p) => [p.instrument_id, p]));
  const fundBy = new Map((funds ?? []).map((f) => [f.instrument_id, f]));
  const market = (insts ?? []).map((m) => {
    const pc = priceBy.get(m.id);
    const f = fundBy.get(m.id);
    const dayPct = pc?.prev_close_cents ? ((pc.last_price_cents - pc.prev_close_cents) / pc.prev_close_cents) * 100 : null;
    return { symbol: m.symbol as string, name: m.name as string | null, last: pc?.last_price_cents ?? null, dayPct, delayed: pc?.is_delayed ?? true, sector: f?.sector ?? null, pe: f?.pe ?? null, beta: f?.beta ?? null, mcap: f?.market_cap_cents ?? null };
  });

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-lg font-semibold">Admin console</h1>
          <p className="text-xs text-neutral-500">Every investor, every position, plus the market feed. Full visibility.</p>
        </div>
        <div className="text-right">
          <div className="text-xs text-neutral-500">Total AUM (paper)</div>
          <div className="text-lg"><Money cents={totalAum} /></div>
        </div>
      </div>

      {/* Investors */}
      <div className="card overflow-x-auto">
        <div className="border-b border-ink-600 px-4 py-3 text-sm font-medium text-neutral-300">Investors ({investors.length})</div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-neutral-500">
            <tr className="border-b border-ink-600">
              <th className="px-4 py-2 font-normal">Investor</th>
              <th className="px-4 py-2 font-normal">Role</th>
              <th className="px-4 py-2 text-right font-normal">Positions</th>
              <th className="px-4 py-2 text-right font-normal">Cash</th>
              <th className="px-4 py-2 text-right font-normal">Unrealized</th>
              <th className="px-4 py-2 text-right font-normal">Equity</th>
              <th className="px-4 py-2 font-normal"></th>
            </tr>
          </thead>
          <tbody>
            {investors.map((i) => (
              <tr key={i.id} className="border-b border-ink-700/50">
                <td className="px-4 py-2 font-medium text-neutral-100">{i.owner}</td>
                <td className="px-4 py-2 text-neutral-400">{i.role}</td>
                <td className="num px-4 py-2 text-right">{i.positions}</td>
                <td className="px-4 py-2 text-right"><Money cents={i.cash} /></td>
                <td className="px-4 py-2 text-right"><Money cents={i.unrl} colored showSign /></td>
                <td className="px-4 py-2 text-right"><Money cents={i.equity} /></td>
                <td className="px-4 py-2 text-right">
                  <Link href={`/command?portfolio=${i.id}`} className="text-gold hover:text-gold-bright">Open →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {investors.length === 0 && <p className="px-4 py-8 text-center text-sm text-neutral-500">No investor portfolios yet.</p>}
      </div>

      {/* Market feed */}
      <div className="card overflow-x-auto">
        <div className="flex items-center justify-between border-b border-ink-600 px-4 py-3">
          <span className="text-sm font-medium text-neutral-300">Market feed (Finnhub)</span>
          {market.some((m) => m.delayed) && <span className="rounded bg-ink-700 px-2 py-0.5 text-[10px] text-gold">DELAYED</span>}
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-neutral-500">
            <tr className="border-b border-ink-600">
              <th className="px-4 py-2 font-normal">Symbol</th>
              <th className="px-4 py-2 font-normal">Sector</th>
              <th className="px-4 py-2 text-right font-normal">Last</th>
              <th className="px-4 py-2 text-right font-normal">Day</th>
              <th className="px-4 py-2 text-right font-normal">P/E</th>
              <th className="px-4 py-2 text-right font-normal">Beta</th>
              <th className="px-4 py-2 text-right font-normal">Mkt cap</th>
            </tr>
          </thead>
          <tbody>
            {market.map((m) => (
              <tr key={m.symbol} className="border-b border-ink-700/50">
                <td className="px-4 py-2"><span className="font-medium text-neutral-100">{m.symbol}</span> <span className="text-xs text-neutral-500">{m.name}</span></td>
                <td className="px-4 py-2 text-neutral-400">{m.sector ?? "—"}</td>
                <td className="px-4 py-2 text-right">{m.last != null ? <Money cents={m.last} /> : "—"}</td>
                <td className="px-4 py-2 text-right">{m.dayPct != null ? <Pct value={m.dayPct} /> : "—"}</td>
                <td className="num px-4 py-2 text-right">{m.pe != null ? Number(m.pe).toFixed(1) : "—"}</td>
                <td className="num px-4 py-2 text-right">{m.beta != null ? Number(m.beta).toFixed(2) : "—"}</td>
                <td className="num px-4 py-2 text-right">{m.mcap != null ? `$${(m.mcap / 100 / 1e9).toFixed(1)}B` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-neutral-600">Admin sees all investor books and the shared market feed. Paper money only — not investment advice.</p>
    </div>
  );
}
