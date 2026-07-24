import { Money } from "@/components/money";

/**
 * Statements — month-end paper records. Presentational: a paper book's
 * statements are a summary view, not a live query. Figures are integer cents.
 */
const MONTHS = [
  { label: "June 2026", pnlCents: 311840, trades: 9, held: 5 },
  { label: "May 2026", pnlCents: -84210, trades: 14, held: 6 },
  { label: "April 2026", pnlCents: 200455, trades: 11, held: 6 },
  { label: "March 2026", pnlCents: 112937, trades: 7, held: 4 },
];

export default function StatementsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Statements</h1>
        <p className="text-xs text-neutral-500">
          Month-end positions, cash movements, and realized P&amp;L. Paper records, plainly kept.
        </p>
      </div>

      <div className="space-y-3">
        {MONTHS.map((m) => (
          <div key={m.label} className="card flex items-center justify-between p-4">
            <div>
              <div className="font-medium text-neutral-100">{m.label}</div>
              <div className="text-xs text-neutral-500">
                {m.trades} trades · {m.held} positions held
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <Money cents={m.pnlCents} colored showSign />
              <span className="cursor-pointer text-xs text-gold">PDF ↓</span>
            </div>
          </div>
        ))}
      </div>

      <div className="card space-y-4 p-6">
        <div className="text-[10px] uppercase tracking-wider text-gold">Custom range</div>
        <div className="grid grid-cols-2 gap-3">
          <input type="date" className="input" defaultValue="2026-01-01" aria-label="From" />
          <input type="date" className="input" defaultValue="2026-07-24" aria-label="To" />
        </div>
        <button type="button" className="btn-gold w-full">Generate statement</button>
      </div>

      <p className="text-xs text-neutral-600">
        Statements describe a simulated book. They are not tax documents and not investment advice.
      </p>
    </div>
  );
}
