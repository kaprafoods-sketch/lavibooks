import type { SupabaseClient } from "@supabase/supabase-js";
import { scoreThesis } from "./thesis";

/**
 * Builds the learning dashboard. A thesis is attached to an opening (buy) order.
 * We score it when the underlying position has been closed: exit price = the
 * price of the most recent sell of that instrument after entry; realized P&L =
 * proceeds − entry cost for the thesis quantity.
 *
 * KNOWN SIMPLIFICATION (v1): scoring matches a thesis to the latest exit of the
 * same instrument, not a precise lot-level linkage. Good enough for aggregate
 * hit-rate analytics; precise per-lot attribution is future work.
 */

export interface ScoredThesis {
  symbol: string;
  conviction: number | null;
  tags: string[];
  targetHit: boolean | null;
  withinHorizon: boolean | null;
  realizedPnlCents: number;
  predictedPnlCents: number | null;
  holdingDays: number;
  text: string | null;
  closed: boolean;
}

export interface LearningSummary {
  scored: ScoredThesis[];
  overallHitRatePct: number | null;
  byTag: { key: string; n: number; hitRatePct: number; avgPnlCents: number }[];
  byConviction: { key: number; n: number; hitRatePct: number; avgPnlCents: number }[];
  best: ScoredThesis | null;
  worst: ScoredThesis | null;
}

export async function getLearningSummary(
  sb: SupabaseClient,
  portfolioId: string,
): Promise<LearningSummary> {
  const { data: theses } = await sb
    .from("theses")
    .select("text,target_price_cents,horizon_days,conviction,tags,created_at,orders(id,side,instrument_id,instruments(symbol),trades(price_cents,qty,side,filled_at))")
    .eq("portfolio_id", portfolioId);

  // All trades for the portfolio, to find exits.
  const { data: allTrades } = await sb
    .from("trades")
    .select("instrument_id,side,price_cents,qty,filled_at")
    .eq("portfolio_id", portfolioId)
    .order("filled_at", { ascending: true });

  const scored: ScoredThesis[] = [];
  for (const t of theses ?? []) {
    const order = t.orders as unknown as {
      side: string; instrument_id: string;
      instruments: { symbol: string };
      trades: { price_cents: number; qty: number; side: string; filled_at: string }[];
    } | null;
    if (!order) continue;
    const entry = order.trades?.find((tr) => tr.side === "buy");
    if (!entry) continue;

    const sells = (allTrades ?? []).filter(
      (tr) => tr.instrument_id === order.instrument_id && tr.side === "sell" && tr.filled_at > entry.filled_at,
    );
    const closed = sells.length > 0;
    const exit = sells[sells.length - 1];
    const qty = entry.qty;
    const realized = closed
      ? Math.round(qty * (exit.price_cents - entry.price_cents))
      : 0;

    const s = scoreThesis(
      {
        side: "buy",
        entryPriceCents: entry.price_cents,
        targetPriceCents: t.target_price_cents,
        horizonDays: t.horizon_days,
        openedAt: entry.filled_at,
      },
      {
        exitPriceCents: closed ? exit.price_cents : entry.price_cents,
        closedAt: closed ? exit.filled_at : new Date().toISOString(),
        qty,
        realizedPnlCents: realized,
      },
    );

    scored.push({
      symbol: order.instruments?.symbol ?? "?",
      conviction: t.conviction,
      tags: t.tags ?? [],
      targetHit: closed ? s.targetHit : null,
      withinHorizon: s.withinHorizon,
      realizedPnlCents: realized,
      predictedPnlCents: s.predictedPnlCents,
      holdingDays: s.holdingDays,
      text: t.text,
      closed,
    });
  }

  const closedWithTarget = scored.filter((s) => s.closed && s.targetHit !== null);
  const overallHitRatePct = closedWithTarget.length
    ? (closedWithTarget.filter((s) => s.targetHit).length / closedWithTarget.length) * 100
    : null;

  // Group helper.
  function group<K extends string | number>(keyer: (s: ScoredThesis) => K[]) {
    const map = new Map<K, ScoredThesis[]>();
    for (const s of scored.filter((x) => x.closed)) {
      for (const k of keyer(s)) {
        if (!map.has(k)) map.set(k, []);
        map.get(k)!.push(s);
      }
    }
    return [...map.entries()].map(([key, items]) => {
      const withTarget = items.filter((i) => i.targetHit !== null);
      const hit = withTarget.length ? (withTarget.filter((i) => i.targetHit).length / withTarget.length) * 100 : 0;
      const avgPnl = Math.round(items.reduce((a, i) => a + i.realizedPnlCents, 0) / items.length);
      return { key, n: items.length, hitRatePct: hit, avgPnlCents: avgPnl };
    });
  }

  const closedScored = scored.filter((s) => s.closed);
  const best = closedScored.length ? closedScored.reduce((a, b) => (b.realizedPnlCents > a.realizedPnlCents ? b : a)) : null;
  const worst = closedScored.length ? closedScored.reduce((a, b) => (b.realizedPnlCents < a.realizedPnlCents ? b : a)) : null;

  return {
    scored,
    overallHitRatePct,
    byTag: group<string>((s) => s.tags).sort((a, b) => b.n - a.n),
    byConviction: group<number>((s) => (s.conviction ? [s.conviction] : [])).sort((a, b) => a.key - b.key),
    best,
    worst,
  };
}
