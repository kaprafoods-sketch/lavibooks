"use client";

import { useActionState, useState } from "react";
import { submitOrder, type OrderFormResult } from "@/app/actions/order";

/** Order ticket with optional thesis capture (the learning layer). */
export function OrderTicket({ portfolioId, symbols }: { portfolioId: string; symbols: string[] }) {
  const [state, action, pending] = useActionState<OrderFormResult | null, FormData>(submitOrder, null);
  const [type, setType] = useState("market");
  const [showThesis, setShowThesis] = useState(false);

  return (
    <form action={action} className="card h-max space-y-3 p-4">
      <input type="hidden" name="portfolio_id" value={portfolioId} />
      <h2 className="text-sm font-medium text-neutral-300">Order ticket</h2>

      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-neutral-500">Symbol
          <input name="symbol" list="symbols" required className="input mt-1" placeholder="AAPL" />
          <datalist id="symbols">{symbols.map((s) => <option key={s} value={s} />)}</datalist>
        </label>
        <label className="text-xs text-neutral-500">Quantity
          <input name="qty" type="number" min="1" step="1" required className="input mt-1" placeholder="10" />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-neutral-500">Side
          <select name="side" className="input mt-1">
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </select>
        </label>
        <label className="text-xs text-neutral-500">Type
          <select name="type" value={type} onChange={(e) => setType(e.target.value)} className="input mt-1">
            <option value="market">Market</option>
            <option value="limit">Limit</option>
            <option value="stop">Stop</option>
          </select>
        </label>
      </div>

      {type === "limit" && (
        <label className="block text-xs text-neutral-500">Limit price ($)
          <input name="limit_price" type="number" step="0.01" className="input mt-1" />
        </label>
      )}
      {type === "stop" && (
        <label className="block text-xs text-neutral-500">Stop price ($)
          <input name="stop_price" type="number" step="0.01" className="input mt-1" />
        </label>
      )}

      <button type="button" onClick={() => setShowThesis((v) => !v)}
        className="text-xs text-gold hover:text-gold-bright">
        {showThesis ? "− Hide" : "+ Add"} thesis (recommended)
      </button>

      {showThesis && (
        <div className="space-y-2 rounded-lg border border-ink-600 p-3">
          <textarea name="thesis_text" rows={2} className="input" placeholder="Why this trade?" />
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-neutral-500">Target ($)
              <input name="target_price" type="number" step="0.01" className="input mt-1" />
            </label>
            <label className="text-xs text-neutral-500">Horizon (days)
              <input name="horizon_days" type="number" min="1" className="input mt-1" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-neutral-500">Conviction (1–5)
              <input name="conviction" type="number" min="1" max="5" className="input mt-1" />
            </label>
            <label className="text-xs text-neutral-500">Tags (comma)
              <input name="tags" className="input mt-1" placeholder="tech, breakout" />
            </label>
          </div>
        </div>
      )}

      <button type="submit" disabled={pending} className="btn-gold w-full">
        {pending ? "Submitting…" : "Submit order"}
      </button>

      {state && (
        <p className={`text-xs ${state.ok ? "gain" : "loss"}`}>{state.message}</p>
      )}
      <p className="text-[10px] text-neutral-600">
        Fills simulate against the last cached price with slippage. Virtual money only.
      </p>
    </form>
  );
}
