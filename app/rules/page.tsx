import Link from "next/link";
import { getDefaultPortfolio } from "@/lib/auth";
import { RuleBuilder } from "@/components/rule-builder";
import { RuleControls } from "@/components/rule-controls";
import { KillSwitch } from "@/components/kill-switch";
import { ruleSummary } from "@/lib/rules/summary";
import { isMarketOpen } from "@/lib/calendar/nyse";

export const dynamic = "force-dynamic";

const statusChip: Record<string, string> = {
  draft: "bg-ink-600 text-neutral-400", armed: "bg-gold/20 text-gold",
  triggered: "bg-gold/20 text-gold", completed: "bg-gain/20 text-gain",
  cancelled: "bg-ink-600 text-neutral-500", expired: "bg-ink-600 text-neutral-500",
  error: "bg-loss/20 text-loss",
};

export default async function RulesPage() {
  const { sb, user, portfolio } = await getDefaultPortfolio();
  if (!user || !portfolio) return <p className="text-sm text-neutral-400">Sign in and seed to manage rules.</p>;

  const [{ data: rules }, { data: settings }, { data: instruments }] = await Promise.all([
    sb.from("rules").select("*,instruments(symbol)").eq("portfolio_id", portfolio.id).order("created_at", { ascending: false }),
    sb.from("automation_settings").select("*").eq("portfolio_id", portfolio.id).maybeSingle(),
    sb.from("instruments").select("symbol").order("symbol"),
  ]);

  const marketOpen = isMarketOpen(new Date());
  const enabled = settings?.automation_enabled ?? false;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Automation rules</h1>
          <p className="text-xs text-neutral-500">
            Next evaluation: {marketOpen ? "within ~1 min (market open)" : "at next market open"} ·{" "}
            <span className="text-gold">EOD/daily-close resolution</span> on the free tier.
          </p>
        </div>
        <KillSwitch portfolioId={portfolio.id} enabled={enabled} />
      </div>

      {!enabled && (
        <div className="card border-loss/40 p-3 text-xs text-loss">
          Automation is disabled (kill switch). Armed rules will not fire until you re-enable.
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-[1fr_380px]">
        <div className="card overflow-hidden">
          <div className="border-b border-ink-600 px-4 py-3 text-sm font-medium text-neutral-300">Your rules</div>
          {(rules ?? []).length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-neutral-500">No rules yet. Create one →</p>
          ) : (
            <ul className="divide-y divide-ink-700/50">
              {(rules ?? []).map((r) => {
                const symbol = (r.instruments as unknown as { symbol: string })?.symbol ?? "—";
                return (
                  <li key={r.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${statusChip[r.status]}`}>{r.status}</span>
                          <span className={`rounded px-1.5 py-0.5 text-[10px] ${r.mode === "live" ? "text-gold" : "text-neutral-500"}`}>{r.mode}</span>
                        </div>
                        <p className="mt-1 text-sm text-neutral-200">{ruleSummary(r.type, r.params, symbol, r.valid_until)}</p>
                        <Link href={`/rules/${r.id}`} className="text-xs text-gold hover:text-gold-bright">Event log & backtest →</Link>
                      </div>
                      <RuleControls ruleId={r.id} status={r.status} mode={r.mode} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <RuleBuilder portfolioId={portfolio.id} symbols={(instruments ?? []).map((i) => i.symbol)} />
      </div>
    </div>
  );
}
