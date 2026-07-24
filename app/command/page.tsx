import Link from "next/link";
import { getDefaultPortfolio } from "@/lib/auth";
import { getCommandView, getDeepDiveBundles } from "@/lib/command-service";
import { CommandCenter } from "@/components/command/command-center";

export const dynamic = "force-dynamic";

const DISCLAIMER =
  "Command Center — paper trading on virtual dollars. Quotes are delayed / last-close on the free data tier and stamped accordingly; stale values are greyed with their real timestamp, never faked. Benchmark and alpha figures are a simulation, not investment advice.";

export default async function CommandPage() {
  const { sb, user, portfolio } = await getDefaultPortfolio();

  if (!user || !portfolio) {
    return (
      <div className="card mx-auto mt-12 max-w-md p-8 text-center">
        <h1 className="text-lg font-semibold">Command Center</h1>
        <p className="mt-2 text-sm text-neutral-400">
          {user ? "No portfolio yet — run the seed script or create one." : "Sign in to open your Command Center."}
        </p>
        <Link href={user ? "/trade" : "/login"} className="btn-gold mt-5 inline-block">{user ? "Go to Trade" : "Sign in"}</Link>
      </div>
    );
  }

  const view = await getCommandView(sb, portfolio.id);
  const bundles = await getDeepDiveBundles(sb, portfolio.id, view.holdings.map((h) => h.instrumentId));

  return <CommandCenter view={view} bundles={bundles} disclaimer={DISCLAIMER} />;
}
