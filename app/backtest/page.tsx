import { getDefaultPortfolio } from "@/lib/auth";
import { BacktestRunner } from "@/components/backtest-runner";

export const dynamic = "force-dynamic";

export default async function BacktestPage() {
  const { sb, user } = await getDefaultPortfolio();
  if (!user) return <p className="text-sm text-neutral-400">Sign in to run backtests.</p>;

  const { data: instruments } = await sb.from("instruments").select("symbol").order("symbol");
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Algorithm sandbox</h1>
        <p className="text-sm text-neutral-500">
          Backtest the SMA-crossover reference strategy over daily bars. Results write to a
          separate algo portfolio so manual vs algorithmic performance sit side by side.
        </p>
      </div>
      <BacktestRunner symbols={(instruments ?? []).map((i) => i.symbol)} />
    </div>
  );
}
