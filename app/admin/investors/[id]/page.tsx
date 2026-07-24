import Link from "next/link";
import { getCurrentRole } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase/server";
import { getPortfolioView } from "@/lib/portfolio-service";
import { Money } from "@/components/money";

export const dynamic = "force-dynamic";

export default async function AdminInvestorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
  const { data: pf } = await sb
    .from("portfolios")
    .select("id, name, created_at, profiles!portfolios_owner_id_fkey(display_name, role)")
    .eq("id", id)
    .maybeSingle();

  if (!pf) {
    return (
      <div className="card mx-auto mt-12 max-w-md p-8 text-center">
        <h1 className="text-lg font-semibold">Not found</h1>
        <p className="mt-2 text-sm text-neutral-400">No such investor book.</p>
        <Link href="/admin" className="btn-gold mt-5 inline-block">← All investors</Link>
      </div>
    );
  }

  const prof = pf.profiles as unknown as { display_name: string | null; role: string } | null;
  const v = await getPortfolioView(sb, id as string);
  const joined = new Date(pf.created_at as string).toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  const stats: { label: string; node: React.ReactNode }[] = [
    { label: "Equity", node: <Money cents={v.equityCents} /> },
    { label: "Cash", node: <Money cents={v.cashCents} /> },
    { label: "Unrealized", node: <Money cents={v.unrealizedPnlCents} colored showSign /> },
    { label: "Positions", node: <span className="num text-neutral-100">{v.positions.length}</span> },
  ];

  return (
    <div className="space-y-6">
      <Link href="/admin" className="text-sm text-gold hover:underline">← All investors</Link>

      <div className="flex items-center gap-4">
        <span className="h-14 w-14 rounded-full border border-ink-600 bg-ink-700" aria-hidden />
        <div>
          <h1 className="text-xl font-semibold">{prof?.display_name ?? (pf.name as string)}</h1>
          <p className="text-xs text-neutral-500">
            {prof?.role ?? "investor"} · joined {joined} · {v.positions.length} positions
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="card p-4">
            <div className="text-xs text-neutral-500">{s.label}</div>
            <div className="mt-1 text-lg">{s.node}</div>
          </div>
        ))}
      </div>

      <div className="card p-4">
        <div className="text-xs text-neutral-500">Equity curve · 6M</div>
        <div className="mt-3 flex h-40 items-center justify-center rounded bg-ink-700 text-xs text-neutral-500">
          Equity curve
        </div>
      </div>

      <div className="card">
        <div className="border-b border-ink-600 px-4 py-3 text-sm font-medium text-neutral-300">Positions</div>
        {v.positions.length === 0 ? (
          <div className="px-4 py-6 text-sm text-neutral-500">No open positions.</div>
        ) : (
          <div className="divide-y divide-ink-600">
            {v.positions.map((p) => (
              <div key={p.symbol} className="flex items-center justify-between px-4 py-3">
                <span>
                  <span className="font-medium text-neutral-100">{p.symbol}</span>{" "}
                  <span className="text-xs text-neutral-500">{p.qty} sh</span>
                </span>
                <Money cents={p.marketValueCents} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
