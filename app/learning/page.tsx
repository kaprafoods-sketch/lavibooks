import { getDefaultPortfolio } from "@/lib/auth";
import { getLearningSummary } from "@/lib/scoring/learning-service";
import { Money } from "@/components/money";

export const dynamic = "force-dynamic";

export default async function LearningPage() {
  const { sb, user, portfolio } = await getDefaultPortfolio();
  if (!user || !portfolio) return <p className="text-sm text-neutral-400">Sign in and seed to view learning analytics.</p>;

  const L = await getLearningSummary(sb, portfolio.id);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Overall hit rate">
          {L.overallHitRatePct == null ? <span className="text-neutral-600">—</span> : <span className="num">{L.overallHitRatePct.toFixed(0)}%</span>}
        </Stat>
        <Stat label="Theses scored"><span className="num">{L.scored.filter((s) => s.closed).length}</span></Stat>
        <Stat label="Open theses"><span className="num">{L.scored.filter((s) => !s.closed).length}</span></Stat>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Hit rate by conviction">
          {L.byConviction.length === 0 ? <Empty /> : L.byConviction.map((r) => (
            <Row key={r.key} label={`${"★".repeat(r.key)} (${r.n})`} hit={r.hitRatePct} pnl={r.avgPnlCents} />
          ))}
        </Panel>
        <Panel title="Hit rate by tag">
          {L.byTag.length === 0 ? <Empty /> : L.byTag.map((r) => (
            <Row key={r.key} label={`${r.key} (${r.n})`} hit={r.hitRatePct} pnl={r.avgPnlCents} />
          ))}
        </Panel>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Decision title="Best decision" t={L.best} />
        <Decision title="Worst decision" t={L.worst} />
      </div>

      <div className="card overflow-x-auto">
        <div className="border-b border-ink-600 px-4 py-3 text-sm font-medium text-neutral-300">All theses</div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-neutral-500">
            <tr className="border-b border-ink-600">
              <th className="px-4 py-2 font-normal">Symbol</th>
              <th className="px-4 py-2 font-normal">Conviction</th>
              <th className="px-4 py-2 font-normal">Target hit</th>
              <th className="px-4 py-2 text-right font-normal">Realized</th>
              <th className="px-4 py-2 text-right font-normal">Predicted</th>
              <th className="px-4 py-2 font-normal">Status</th>
            </tr>
          </thead>
          <tbody>
            {L.scored.map((s, i) => (
              <tr key={i} className="border-b border-ink-700/50">
                <td className="px-4 py-2 font-medium">{s.symbol}</td>
                <td className="num px-4 py-2 text-gold">{s.conviction ? "★".repeat(s.conviction) : "—"}</td>
                <td className="px-4 py-2">{s.targetHit == null ? "—" : s.targetHit ? <span className="gain">yes</span> : <span className="loss">no</span>}</td>
                <td className="px-4 py-2 text-right">{s.closed ? <Money cents={s.realizedPnlCents} colored showSign /> : "—"}</td>
                <td className="px-4 py-2 text-right">{s.predictedPnlCents == null ? "—" : <Money cents={s.predictedPnlCents} />}</td>
                <td className="px-4 py-2 text-xs text-neutral-500">{s.closed ? "closed" : "open"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {L.scored.length === 0 && <p className="px-4 py-8 text-center text-sm text-neutral-500">No theses captured yet. Add one on your next order.</p>}
      </div>
      <p className="text-xs text-neutral-600">
        Scoring links each thesis to the latest exit of the same instrument — good for aggregate hit rates; precise per-lot attribution is future work.
      </p>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="card p-3"><div className="text-xs text-neutral-500">{label}</div><div className="mt-1 text-lg">{children}</div></div>;
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="card p-4"><h3 className="mb-3 text-sm font-medium text-neutral-300">{title}</h3><div className="space-y-2">{children}</div></div>;
}
function Row({ label, hit, pnl }: { label: string; hit: number; pnl: number }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-neutral-300">{label}</span>
      <span className="flex items-center gap-3">
        <span className="num text-neutral-400">{hit.toFixed(0)}% hit</span>
        <Money cents={pnl} colored showSign />
      </span>
    </div>
  );
}
function Empty() { return <p className="text-xs text-neutral-600">No closed theses yet.</p>; }
function Decision({ title, t }: { title: string; t: import("@/lib/scoring/learning-service").ScoredThesis | null }) {
  return (
    <div className="card p-4">
      <h3 className="mb-2 text-sm font-medium text-neutral-300">{title}</h3>
      {t ? (
        <div>
          <div className="flex items-center justify-between">
            <span className="font-medium">{t.symbol}</span>
            <Money cents={t.realizedPnlCents} colored showSign />
          </div>
          {t.text && <p className="mt-1 text-xs text-neutral-500">{t.text}</p>}
        </div>
      ) : <p className="text-xs text-neutral-600">No closed theses yet.</p>}
    </div>
  );
}
