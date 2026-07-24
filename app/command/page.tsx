import Link from "next/link";
import { getDefaultPortfolio, getCurrentRole } from "@/lib/auth";
import { getCommandView, getDeepDiveBundles } from "@/lib/command-service";
import { CommandCenter } from "@/components/command/command-center";

export const dynamic = "force-dynamic";

const DISCLAIMER =
  "Command Center — paper trading on virtual dollars. Quotes are delayed / last-close on the free data tier and stamped accordingly; stale values are greyed with their real timestamp, never faked. Benchmark and alpha figures are a simulation, not investment advice.";

export default async function CommandPage({
  searchParams,
}: {
  searchParams: Promise<{ portfolio?: string }>;
}) {
  const { sb, user, portfolio } = await getDefaultPortfolio();
  const role = await getCurrentRole();
  const sp = await searchParams;

  if (!user) {
    return (
      <div className="card mx-auto mt-12 max-w-md p-8 text-center">
        <h1 className="text-lg font-semibold">Command Center</h1>
        <p className="mt-2 text-sm text-neutral-400">Sign in to open your Command Center.</p>
        <Link href="/login" className="btn-gold mt-5 inline-block">Sign in</Link>
      </div>
    );
  }

  // Admins may view any investor's portfolio via ?portfolio=<id>; everyone else
  // is scoped to their own (RLS enforces this server-side regardless).
  let targetId = portfolio?.id ?? null;
  let viewingLabel: string | undefined;
  if (sp.portfolio && role === "admin") {
    targetId = sp.portfolio;
    const { data: pf } = await sb
      .from("portfolios")
      .select("name, profiles!portfolios_owner_id_fkey(display_name)")
      .eq("id", sp.portfolio)
      .maybeSingle();
    const owner = (pf?.profiles as unknown as { display_name: string | null } | null)?.display_name;
    viewingLabel = `admin view · ${owner ?? "investor"}`;
  }

  if (!targetId) {
    return (
      <div className="card mx-auto mt-12 max-w-md p-8 text-center">
        <h1 className="text-lg font-semibold">Command Center</h1>
        <p className="mt-2 text-sm text-neutral-400">No portfolio yet.</p>
        <Link href="/trade" className="btn-gold mt-5 inline-block">Go to Trade</Link>
      </div>
    );
  }

  const view = await getCommandView(sb, targetId);
  const bundles = await getDeepDiveBundles(sb, targetId, view.holdings.map((h) => h.instrumentId));

  return <CommandCenter view={view} bundles={bundles} disclaimer={DISCLAIMER} viewingLabel={viewingLabel} />;
}
