import type { SupabaseClient } from "@supabase/supabase-js";
import { deriveBalanceCents } from "./engine/ledger";
import { weightedAvgCostCents, unrealizedPnlCents } from "./engine/lots";
import type { Lot } from "./types";

/**
 * Read-side portfolio aggregation. Reads ledger + lots + price_cache and derives
 * balance, positions (weighted-avg cost), market value, and unrealized P&L.
 * Prices come from price_cache ONLY — never a vendor call here.
 */

export interface PositionView {
  instrumentId: string;
  symbol: string;
  qty: number;
  avgCostCents: number;
  markCents: number;
  isDelayed: boolean;
  marketValueCents: number;
  unrealizedPnlCents: number;
}

export interface PortfolioView {
  cashCents: number;
  positions: PositionView[];
  positionsValueCents: number;
  equityCents: number;
  unrealizedPnlCents: number;
}

export async function getPortfolioView(
  sb: SupabaseClient,
  portfolioId: string,
): Promise<PortfolioView> {
  const [{ data: ledger }, { data: lotRows }] = await Promise.all([
    sb.from("cash_ledger").select("amount_cents,reason").eq("portfolio_id", portfolioId),
    sb
      .from("lots")
      .select("id,instrument_id,qty_open,qty_original,cost_cents,opened_at,instruments(symbol)")
      .eq("portfolio_id", portfolioId)
      .gt("qty_open", 0),
  ]);

  const cashCents = deriveBalanceCents(
    (ledger ?? []).map((r) => ({ amountCents: r.amount_cents, reason: r.reason })),
  );

  // Group lots by instrument.
  const byInstrument = new Map<string, { symbol: string; lots: Lot[] }>();
  for (const r of lotRows ?? []) {
    const symbol = (r.instruments as unknown as { symbol: string })?.symbol ?? "?";
    if (!byInstrument.has(r.instrument_id)) {
      byInstrument.set(r.instrument_id, { symbol, lots: [] });
    }
    byInstrument.get(r.instrument_id)!.lots.push({
      id: r.id,
      qtyOpen: Number(r.qty_open),
      qtyOriginal: Number(r.qty_original),
      costCents: r.cost_cents,
      openedAt: r.opened_at,
    });
  }

  const instrumentIds = [...byInstrument.keys()];
  const priceMap = new Map<string, { last: number; delayed: boolean }>();
  if (instrumentIds.length) {
    const { data: prices } = await sb
      .from("price_cache")
      .select("instrument_id,last_price_cents,is_delayed")
      .in("instrument_id", instrumentIds);
    for (const p of prices ?? []) {
      priceMap.set(p.instrument_id, { last: p.last_price_cents, delayed: p.is_delayed });
    }
  }

  const positions: PositionView[] = [];
  for (const [instrumentId, { symbol, lots }] of byInstrument) {
    const qty = lots.reduce((a, l) => a + l.qtyOpen, 0);
    const avgCost = weightedAvgCostCents(lots);
    const price = priceMap.get(instrumentId);
    const mark = price?.last ?? avgCost; // fall back to cost if uncached
    positions.push({
      instrumentId,
      symbol,
      qty,
      avgCostCents: avgCost,
      markCents: mark,
      isDelayed: price?.delayed ?? true,
      marketValueCents: Math.round(qty * mark),
      unrealizedPnlCents: unrealizedPnlCents(lots, mark),
    });
  }
  positions.sort((a, b) => a.symbol.localeCompare(b.symbol));

  const positionsValueCents = positions.reduce((a, p) => a + p.marketValueCents, 0);
  const unrealPnl = positions.reduce((a, p) => a + p.unrealizedPnlCents, 0);

  return {
    cashCents,
    positions,
    positionsValueCents,
    equityCents: cashCents + positionsValueCents,
    unrealizedPnlCents: unrealPnl,
  };
}
