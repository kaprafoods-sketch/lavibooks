"use client";

import { useActionState } from "react";
import { runBacktestAction, type BacktestActionResult } from "@/app/actions/backtest";
import { EquityCurve } from "./equity-curve";
import { Money } from "./money";

export function BacktestRunner({ symbols }: { symbols: string[] }) {
  const [state, action, pending] = useActionState<BacktestActionResult | null, FormData>(runBacktestAction, null);
  const m = state?.result?.metrics;

  return (
    <div className="grid gap-6 md:grid-cols-[320px_1fr]">
      <form action={action} className="card h-max space-y-3 p-4">
        <label className="block text-xs text-neutral-500">Symbol
          <input name="symbol" list="bt-symbols" required className="input mt-1" placeholder="AAPL" />
          <datalist id="bt-symbols">{symbols.map((s) => <option key={s} value={s} />)}</datalist>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-neutral-500">Fast SMA
            <input name="fast" type="number" defaultValue={20} min="2" className="input mt-1" />
          </label>
          <label className="text-xs text-neutral-500">Slow SMA
            <input name="slow" type="number" defaultValue={50} min="3" className="input mt-1" />
          </label>
        </div>
        <label className="block text-xs text-neutral-500">Start cash ($)
          <input name="start_cash" type="number" defaultValue={100000} className="input mt-1" />
        </label>
        <button type="submit" disabled={pending} className="btn-gold w-full">{pending ? "Running…" : "Run backtest"}</button>
        {state && !state.ok && <p className="loss text-xs">{state.message}</p>}
      </form>

      <div className="space-y-4">
        {m ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Metric label="Total return" value={`${m.totalReturnPct.toFixed(1)}%`} good={m.totalReturnPct >= 0} />
              <Metric label="CAGR" value={`${m.cagrPct.toFixed(1)}%`} good={m.cagrPct >= 0} />
              <Metric label="Max drawdown" value={`-${m.maxDrawdownPct.toFixed(1)}%`} good={false} />
              <Metric label="Win rate" value={`${m.winRatePct.toFixed(0)}%`} />
              <Metric label="Sharpe" value={m.sharpe.toFixed(2)} good={m.sharpe >= 0} />
              <Metric label="End equity" value="" cents={m.endEquityCents} />
            </div>
            <div className="card p-4">
              <h3 className="mb-3 text-sm font-medium text-neutral-300">{state?.symbol} — equity curve</h3>
              <EquityCurve data={state!.result!.equityCurveCents.map((c, i) => ({ d: String(i), equity: c / 100 }))} />
            </div>
            <p className="text-xs text-neutral-600">
              Sharpe assumes a 0% risk-free rate on daily returns (EOD resolution). {state!.result!.trades.length} trades.
            </p>
          </>
        ) : (
          <div className="card p-8 text-center text-sm text-neutral-500">Run a backtest to see metrics and the equity curve.</div>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, cents, good }: { label: string; value: string; cents?: number; good?: boolean }) {
  const cls = good === undefined ? "" : good ? "gain" : "loss";
  return (
    <div className="card p-3">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`num mt-1 text-lg ${cls}`}>{cents != null ? <Money cents={cents} /> : value}</div>
    </div>
  );
}
