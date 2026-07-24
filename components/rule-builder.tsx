"use client";

import { useActionState, useMemo, useState } from "react";
import { createRule, type RuleActionResult } from "@/app/actions/rules";
import { ruleSummary } from "@/lib/rules/summary";
import { toCents } from "@/lib/money";
import type { RuleParams, RuleType } from "@/lib/rules/types";

/** Rule builder with a live plain-language summary generated from the form. */
export function RuleBuilder({ portfolioId, symbols }: { portfolioId: string; symbols: string[] }) {
  const [state, action, pending] = useActionState<RuleActionResult | null, FormData>(createRule, null);
  const [type, setType] = useState<RuleType>("stop_loss");
  const [f, setF] = useState<Record<string, string>>({ symbol: "", qty: "40", stop_mode: "pct_below_entry", stop_pct: "5", take_mode: "pct_gain", take_pct: "15", entry_mode: "cross_above", sched_action: "place_at_open", trading_days: "5", mode: "simulate", side: "buy" });
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  const summary = useMemo(() => {
    try {
      const params = buildPreviewParams(type, f);
      return ruleSummary(type, params, f.symbol || "SYMBOL", f.valid_until || null);
    } catch { return "Complete the fields to see the plain-language summary."; }
  }, [type, f]);

  return (
    <form action={action} className="card space-y-3 p-4">
      <input type="hidden" name="portfolio_id" value={portfolioId} />
      <h2 className="text-sm font-medium text-neutral-300">New rule</h2>

      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-neutral-500">Type
          <select name="type" value={type} onChange={(e) => setType(e.target.value as RuleType)} className="input mt-1">
            <option value="stop_loss">Stop-loss</option>
            <option value="take_profit">Take-profit</option>
            <option value="bracket_oco">Bracket / OCO</option>
            <option value="conditional_entry">Conditional entry</option>
            <option value="scheduled">Scheduled</option>
            <option value="time_stop">Time stop</option>
          </select>
        </label>
        <label className="text-xs text-neutral-500">Symbol
          <input name="symbol" list="rule-symbols" value={f.symbol} onChange={(e) => set("symbol", e.target.value.toUpperCase())} className="input mt-1" placeholder="AAPL" />
          <datalist id="rule-symbols">{symbols.map((s) => <option key={s} value={s} />)}</datalist>
        </label>
      </div>

      {type !== "scheduled" && (
        <label className="block text-xs text-neutral-500">Quantity
          <input name="qty" type="number" min="1" value={f.qty} onChange={(e) => set("qty", e.target.value)} className="input mt-1" />
        </label>
      )}

      {(type === "stop_loss" || type === "bracket_oco") && (
        <StopFields f={f} set={set} prefix={type === "bracket_oco" ? "sl_" : ""} />
      )}
      {(type === "take_profit" || type === "bracket_oco") && (
        <TakeFields f={f} set={set} prefix={type === "bracket_oco" ? "tp_" : ""} />
      )}
      {type === "conditional_entry" && <EntryFields f={f} set={set} />}
      {type === "scheduled" && <SchedFields f={f} set={set} />}
      {type === "time_stop" && (
        <label className="block text-xs text-neutral-500">Trading days
          <input name="trading_days" type="number" min="1" value={f.trading_days} onChange={(e) => set("trading_days", e.target.value)} className="input mt-1" />
        </label>
      )}

      <label className="block text-xs text-neutral-500">Good until (optional)
        <input name="valid_until" type="date" value={f.valid_until ?? ""} onChange={(e) => set("valid_until", e.target.value)} className="input mt-1" />
      </label>

      <label className="block text-xs text-neutral-500">Mode
        <select name="mode" value={f.mode} onChange={(e) => set("mode", e.target.value)} className="input mt-1">
          <option value="simulate">Simulate (dry-run — logs only, no orders)</option>
          <option value="live">Live (paper fills)</option>
        </select>
      </label>

      {/* Always-visible plain-language summary */}
      <div className="rounded-lg border border-gold/30 bg-ink-900 p-3 text-sm text-neutral-200">
        <div className="mb-1 text-[10px] uppercase tracking-wider text-gold">This rule will</div>
        {summary}
      </div>

      <button type="submit" disabled={pending} className="btn-gold w-full">{pending ? "Saving…" : "Create rule"}</button>
      {state && <p className={`text-xs ${state.ok ? "gain" : "loss"}`}>{state.message}</p>}
    </form>
  );
}

function StopFields({ f, set, prefix }: { f: Record<string, string>; set: (k: string, v: string) => void; prefix: string }) {
  return (
    <div className="space-y-2 rounded-lg border border-ink-600 p-3">
      <div className="text-xs text-loss">Stop-loss leg</div>
      <select name={`${prefix}stop_mode`} value={f[`${prefix}stop_mode`] ?? f.stop_mode} onChange={(e) => set(`${prefix}stop_mode`, e.target.value)} className="input">
        <option value="absolute">Absolute price</option>
        <option value="pct_below_entry">% below entry</option>
        <option value="trailing_pct">Trailing % (from highest close)</option>
      </select>
      {(f[`${prefix}stop_mode`] ?? f.stop_mode) === "absolute"
        ? <input name={`${prefix}stop_price`} type="number" step="0.01" placeholder="Stop $" value={f[`${prefix}stop_price`] ?? ""} onChange={(e) => set(`${prefix}stop_price`, e.target.value)} className="input" />
        : <input name={`${prefix}stop_pct`} type="number" step="0.1" placeholder="%" value={f[`${prefix}stop_pct`] ?? f.stop_pct} onChange={(e) => set(`${prefix}stop_pct`, e.target.value)} className="input" />}
    </div>
  );
}
function TakeFields({ f, set, prefix }: { f: Record<string, string>; set: (k: string, v: string) => void; prefix: string }) {
  return (
    <div className="space-y-2 rounded-lg border border-ink-600 p-3">
      <div className="text-xs text-gain">Take-profit leg</div>
      <select name={`${prefix}take_mode`} value={f[`${prefix}take_mode`] ?? f.take_mode} onChange={(e) => set(`${prefix}take_mode`, e.target.value)} className="input">
        <option value="absolute">Absolute price</option>
        <option value="pct_gain">% gain</option>
        <option value="r_multiple">R-multiple</option>
      </select>
      {(f[`${prefix}take_mode`] ?? f.take_mode) === "absolute"
        ? <input name={`${prefix}take_price`} type="number" step="0.01" placeholder="Target $" value={f[`${prefix}take_price`] ?? ""} onChange={(e) => set(`${prefix}take_price`, e.target.value)} className="input" />
        : (f[`${prefix}take_mode`] ?? f.take_mode) === "r_multiple"
        ? <input name={`${prefix}take_r`} type="number" step="0.1" placeholder="R (e.g. 2)" value={f[`${prefix}take_r`] ?? "2"} onChange={(e) => set(`${prefix}take_r`, e.target.value)} className="input" />
        : <input name={`${prefix}take_pct`} type="number" step="0.1" placeholder="%" value={f[`${prefix}take_pct`] ?? f.take_pct} onChange={(e) => set(`${prefix}take_pct`, e.target.value)} className="input" />}
    </div>
  );
}
function EntryFields({ f, set }: { f: Record<string, string>; set: (k: string, v: string) => void }) {
  return (
    <div className="space-y-2 rounded-lg border border-ink-600 p-3">
      <select name="side" value={f.side} onChange={(e) => set("side", e.target.value)} className="input">
        <option value="buy">Buy</option><option value="sell">Sell</option>
      </select>
      <select name="entry_mode" value={f.entry_mode} onChange={(e) => set("entry_mode", e.target.value)} className="input">
        <option value="cross_above">When price crosses above</option>
        <option value="cross_below">When price crosses below</option>
        <option value="strategy">When SMA crossover fires</option>
      </select>
      {f.entry_mode === "strategy"
        ? <div className="grid grid-cols-2 gap-2">
            <input name="fast" type="number" placeholder="Fast" value={f.fast ?? "20"} onChange={(e) => set("fast", e.target.value)} className="input" />
            <input name="slow" type="number" placeholder="Slow" value={f.slow ?? "50"} onChange={(e) => set("slow", e.target.value)} className="input" />
          </div>
        : <input name="cross_price" type="number" step="0.01" placeholder="Price $" value={f.cross_price ?? ""} onChange={(e) => set("cross_price", e.target.value)} className="input" />}
    </div>
  );
}
function SchedFields({ f, set }: { f: Record<string, string>; set: (k: string, v: string) => void }) {
  return (
    <div className="space-y-2 rounded-lg border border-ink-600 p-3">
      <select name="sched_action" value={f.sched_action} onChange={(e) => set("sched_action", e.target.value)} className="input">
        <option value="place_at_open">Place at next open</option>
        <option value="eod_flatten">Flatten before close</option>
      </select>
      {f.sched_action === "eod_flatten"
        ? <input name="minutes_before_close" type="number" placeholder="Minutes before close" value={f.minutes_before_close ?? "15"} onChange={(e) => set("minutes_before_close", e.target.value)} className="input" />
        : <div className="grid grid-cols-2 gap-2">
            <select name="side" value={f.side} onChange={(e) => set("side", e.target.value)} className="input"><option value="buy">Buy</option><option value="sell">Sell</option></select>
            <input name="qty" type="number" placeholder="Qty" value={f.qty} onChange={(e) => set("qty", e.target.value)} className="input" />
          </div>}
    </div>
  );
}

// Mirror the server-side param building for the live preview.
function buildPreviewParams(type: RuleType, f: Record<string, string>): RuleParams {
  const qty = Number(f.qty || 0);
  const stop = (prefix = "") => {
    const m = f[`${prefix}stop_mode`] ?? f.stop_mode;
    if (m === "absolute") return { mode: "absolute" as const, price_cents: toCents(Number(f[`${prefix}stop_price`] || 0)) };
    return { mode: m as "pct_below_entry" | "trailing_pct", pct: Number(f[`${prefix}stop_pct`] ?? f.stop_pct ?? 5) };
  };
  const take = (prefix = "") => {
    const m = f[`${prefix}take_mode`] ?? f.take_mode;
    if (m === "absolute") return { mode: "absolute" as const, price_cents: toCents(Number(f[`${prefix}take_price`] || 0)) };
    if (m === "r_multiple") return { mode: "r_multiple" as const, r: Number(f[`${prefix}take_r`] || 2), initial_risk_cents: 0 };
    return { mode: "pct_gain" as const, pct: Number(f[`${prefix}take_pct`] ?? f.take_pct ?? 15) };
  };
  switch (type) {
    case "stop_loss": return { qty, trigger: stop() };
    case "take_profit": return { qty, trigger: take() };
    case "bracket_oco": return { qty, take_profit: take("tp_"), stop_loss: stop("sl_") };
    case "conditional_entry":
      return f.entry_mode === "strategy"
        ? { side: (f.side as "buy" | "sell") || "buy", qty, trigger: { mode: "strategy", strategy: "sma_crossover", fast: Number(f.fast || 20), slow: Number(f.slow || 50) } }
        : { side: (f.side as "buy" | "sell") || "buy", qty, trigger: { mode: (f.entry_mode as "cross_above" | "cross_below"), price_cents: toCents(Number(f.cross_price || 0)) } };
    case "scheduled":
      return f.sched_action === "eod_flatten"
        ? { action: "eod_flatten", minutes_before_close: Number(f.minutes_before_close || 15) }
        : { action: "place_at_open", side: (f.side as "buy" | "sell") || "buy", qty };
    case "time_stop": return { qty, trading_days: Number(f.trading_days || 5) };
  }
}
