import type { SupabaseClient } from "@supabase/supabase-js";
import { getPortfolioView } from "./portfolio-service";

/**
 * M8 Command Center read-side. Assembles the ENTIRE cockpit snapshot from
 * Postgres / price_cache in a handful of batched queries. No vendor calls here —
 * quotes come from price_cache exactly like the rest of the app. Every field is
 * a stored row or a pure function over stored rows (§M8.2 of PLAN.md).
 */

const TTL_SECONDS = Number(process.env.PRICE_CACHE_TTL_SECONDS ?? 60);
const SPARK_DAYS = 30;

export interface RuleChip {
  kind: "stop" | "target";
  priceCents: number;
}

export interface ThesisStatus {
  targetPriceCents: number | null;
  horizonDays: number | null;
  daysHeld: number;
  daysRemaining: number | null;
  onTrack: boolean | null; // last >= entry for a long, moving toward target
  progressPct: number | null; // entry→target progress at current price
  text: string | null;
}

export interface HoldingRow {
  instrumentId: string;
  symbol: string;
  name: string | null;
  sector: string | null;
  qty: number;
  avgCostCents: number;
  lastCents: number;
  prevCloseCents: number | null;
  marketValueCents: number;
  dayChangePct: number | null;
  dayPnlCents: number | null;
  unrealizedPnlCents: number;
  unrealizedPct: number;
  weightPct: number;
  realizedPnlCents: number;
  holdingDays: number;
  spark: number[]; // recent daily closes in dollars
  rules: RuleChip[];
  thesis: ThesisStatus | null;
  isDelayed: boolean;
  isStale: boolean;
  fetchedAt: string | null;
}

export interface AllocationSlice {
  key: string;
  valueCents: number;
  pct: number;
}

export interface CommandView {
  asOf: string | null; // oldest fetched_at across held symbols
  anyStale: boolean;
  anyDelayed: boolean;
  cashCents: number;
  positionsValueCents: number;
  equityCents: number;
  buyingPowerCents: number;
  unrealizedPnlCents: number;
  realizedPnlCents: number;
  dayPnlCents: number;
  dayPnlPct: number;
  investedPct: number;
  cashPct: number;
  holdings: HoldingRow[];
  best: HoldingRow | null;
  worst: HoldingRow | null;
  armedRules: number;
  automationEnabled: boolean;
  allocationBySector: AllocationSlice[];
  concentrationPct: number; // largest single-name weight
  equityCurve: { d: string; equity: number }[];
}

interface TradeRow {
  instrument_id: string;
  side: string;
  qty: number;
  price_cents: number;
  filled_at: string;
}

/**
 * FIFO realized P&L per instrument over a trade history. Pure + deterministic —
 * the single source for "realized to date" and performance attribution.
 * Pairs each sell against the oldest open buys.
 */
export function realizedPnlByInstrument(trades: TradeRow[]): Map<string, number> {
  const byInst = new Map<string, TradeRow[]>();
  for (const t of trades) {
    if (!byInst.has(t.instrument_id)) byInst.set(t.instrument_id, []);
    byInst.get(t.instrument_id)!.push(t);
  }
  const out = new Map<string, number>();
  for (const [inst, list] of byInst) {
    const buys: { qty: number; price: number }[] = [];
    let realized = 0;
    for (const t of [...list].sort((a, b) => a.filled_at.localeCompare(b.filled_at))) {
      if (t.side === "buy") {
        buys.push({ qty: Number(t.qty), price: t.price_cents });
      } else {
        let remaining = Number(t.qty);
        while (remaining > 0 && buys.length) {
          const lot = buys[0];
          const take = Math.min(remaining, lot.qty);
          realized += Math.round(take * (t.price_cents - lot.price));
          lot.qty -= take;
          remaining -= take;
          if (lot.qty <= 1e-9) buys.shift();
        }
      }
    }
    out.set(inst, realized);
  }
  return out;
}

function daysBetween(fromIso: string, to = Date.now()): number {
  return Math.max(0, Math.floor((to - new Date(fromIso).getTime()) / 86_400_000));
}

export interface DeepDiveBar { d: string; o: number; h: number; l: number; c: number; v: number }
export interface DeepDiveTrade { side: string; qty: number; priceCents: number; at: string; automated: boolean }
export interface DeepDiveThesis { text: string | null; targetCents: number | null; horizonDays: number | null; createdAt: string; targetHit: boolean | null; realizedPnlCents: number | null }
export interface DeepDiveEvent { at: string; decision: string; reason: string; priceCents: number | null; stale: boolean }
export interface DeepDiveLevel { kind: "stop" | "target"; priceCents: number }
export interface Fundamentals {
  sector: string | null; marketCapCents: number | null; pe: number | null; epsCents: number | null;
  beta: number | null; dividendYield: number | null; high52wCents: number | null; low52wCents: number | null;
  netMargin: number | null; grossMargin: number | null; fetchedAt: string | null; isPartial: boolean;
}
export interface DeepDiveBundle {
  instrumentId: string;
  bars: DeepDiveBar[];
  trades: DeepDiveTrade[];
  theses: DeepDiveThesis[];
  events: DeepDiveEvent[];
  levels: DeepDiveLevel[];
  fundamentals: Fundamentals | null;
  news: { headline: string; url: string | null; source: string | null; publishedAt: string }[];
  nextEarnings: { date: string | null; available: boolean } | null;
}

/**
 * Zone-C deep-dive bundles for the held names. Portfolios are small, so we
 * prefetch all of them server-side (still cache-only reads) and hydrate the
 * client panel from memory — no per-tab round-trip, no vendor call.
 */
export async function getDeepDiveBundles(
  sb: SupabaseClient,
  portfolioId: string,
  instrumentIds: string[],
): Promise<Record<string, DeepDiveBundle>> {
  const ids = instrumentIds.length ? instrumentIds : ["00000000-0000-0000-0000-000000000000"];
  const [
    { data: bars }, { data: trades }, { data: theses }, { data: events },
    { data: rules }, { data: funds }, { data: news }, { data: earnings },
  ] = await Promise.all([
    sb.from("daily_bars").select("instrument_id,d,open_cents,high_cents,low_cents,close_cents,volume").in("instrument_id", ids).order("d", { ascending: true }),
    sb.from("trades").select("instrument_id,side,qty,price_cents,filled_at,automated").eq("portfolio_id", portfolioId).in("instrument_id", ids).order("filled_at", { ascending: true }),
    sb.from("theses").select("text,target_price_cents,horizon_days,created_at,target_hit,realized_pnl_cents,orders(instrument_id)").eq("portfolio_id", portfolioId),
    sb.from("rule_events").select("evaluated_at,decision,reason_text,market_price_cents,price_is_stale,rules(instrument_id)").eq("portfolio_id", portfolioId).order("evaluated_at", { ascending: false }).limit(200),
    sb.from("rules").select("instrument_id,type,params,status").eq("portfolio_id", portfolioId).in("status", ["armed", "triggered"]).in("instrument_id", ids),
    sb.from("fundamentals_cache").select("*").in("instrument_id", ids),
    sb.from("news_cache").select("instrument_id,headline,url,source,published_at").in("instrument_id", ids).order("published_at", { ascending: false }).limit(200),
    sb.from("earnings_cache").select("instrument_id,next_earnings_date,available").in("instrument_id", ids),
  ]);

  const fundBy = new Map((funds ?? []).map((f) => [f.instrument_id, f]));
  const earnBy = new Map((earnings ?? []).map((e) => [e.instrument_id, e]));
  const out: Record<string, DeepDiveBundle> = {};

  for (const id of instrumentIds) {
    const f = fundBy.get(id);
    const e = earnBy.get(id);
    out[id] = {
      instrumentId: id,
      bars: (bars ?? []).filter((b) => b.instrument_id === id).map((b) => ({
        d: b.d, o: (b.open_cents ?? 0) / 100, h: (b.high_cents ?? 0) / 100,
        l: (b.low_cents ?? 0) / 100, c: (b.close_cents ?? 0) / 100, v: Number(b.volume ?? 0),
      })),
      trades: (trades ?? []).filter((t) => t.instrument_id === id).map((t) => ({
        side: t.side, qty: Number(t.qty), priceCents: t.price_cents, at: t.filled_at, automated: !!t.automated,
      })),
      theses: (theses ?? [])
        .filter((t) => (t.orders as unknown as { instrument_id: string } | null)?.instrument_id === id)
        .map((t) => ({
          text: t.text ?? null, targetCents: t.target_price_cents ?? null, horizonDays: t.horizon_days ?? null,
          createdAt: t.created_at, targetHit: t.target_hit ?? null, realizedPnlCents: t.realized_pnl_cents ?? null,
        })),
      events: (events ?? [])
        .filter((ev) => (ev.rules as unknown as { instrument_id: string } | null)?.instrument_id === id)
        .map((ev) => ({ at: ev.evaluated_at, decision: ev.decision, reason: ev.reason_text, priceCents: ev.market_price_cents ?? null, stale: !!ev.price_is_stale })),
      levels: (rules ?? []).filter((r) => r.instrument_id === id).flatMap((r) => {
        const p = (r.params ?? {}) as Record<string, number>;
        const ls: DeepDiveLevel[] = [];
        const stop = p.stop_price_cents ?? p.stopPriceCents;
        const target = p.target_price_cents ?? p.takeProfitPriceCents ?? p.target_cents;
        if (stop) ls.push({ kind: "stop", priceCents: stop });
        if (target) ls.push({ kind: "target", priceCents: target });
        return ls;
      }),
      fundamentals: f
        ? {
            sector: f.sector ?? null, marketCapCents: f.market_cap_cents ?? null, pe: f.pe ?? null,
            epsCents: f.eps_cents ?? null, beta: f.beta ?? null, dividendYield: f.dividend_yield ?? null,
            high52wCents: f.high_52w_cents ?? null, low52wCents: f.low_52w_cents ?? null,
            netMargin: f.net_margin ?? null, grossMargin: f.gross_margin ?? null,
            fetchedAt: f.fetched_at ?? null, isPartial: f.is_partial ?? true,
          }
        : null,
      news: (news ?? []).filter((n) => n.instrument_id === id).map((n) => ({
        headline: n.headline, url: n.url ?? null, source: n.source ?? null, publishedAt: n.published_at,
      })),
      nextEarnings: e ? { date: e.next_earnings_date ?? null, available: e.available ?? false } : null,
    };
  }
  return out;
}

export async function getCommandView(
  sb: SupabaseClient,
  portfolioId: string,
): Promise<CommandView> {
  // Base position view (cash, lots, marks, unrealized) — reuse Phase-1 service.
  const base = await getPortfolioView(sb, portfolioId);
  const instrumentIds = base.positions.map((p) => p.instrumentId);

  // One batched pull for everything the grid needs, keyed by the held set.
  const [
    { data: instRows },
    { data: priceRows },
    { data: barRows },
    { data: tradeRows },
    { data: ruleRows },
    { data: thesisRows },
    { data: fundRows },
    { data: snapRows },
    { data: autoRow },
  ] = await Promise.all([
    sb.from("instruments").select("id,symbol,name").in("id", instrumentIds.length ? instrumentIds : ["00000000-0000-0000-0000-000000000000"]),
    sb.from("price_cache").select("instrument_id,last_price_cents,prev_close_cents,fetched_at,is_delayed").in("instrument_id", instrumentIds.length ? instrumentIds : ["0"]),
    sb.from("daily_bars").select("instrument_id,d,close_cents").in("instrument_id", instrumentIds.length ? instrumentIds : ["0"]).order("d", { ascending: true }),
    sb.from("trades").select("instrument_id,side,qty,price_cents,filled_at").eq("portfolio_id", portfolioId),
    sb.from("rules").select("instrument_id,type,params,status").eq("portfolio_id", portfolioId).in("status", ["armed", "triggered"]),
    sb.from("theses").select("text,target_price_cents,horizon_days,created_at,scored_at,orders(instrument_id,side)").eq("portfolio_id", portfolioId),
    sb.from("fundamentals_cache").select("instrument_id,sector").in("instrument_id", instrumentIds.length ? instrumentIds : ["0"]),
    sb.from("snapshots").select("d,equity_cents").eq("portfolio_id", portfolioId).order("d", { ascending: true }),
    sb.from("automation_settings").select("automation_enabled").eq("portfolio_id", portfolioId).maybeSingle(),
  ]);

  const nameBy = new Map((instRows ?? []).map((r) => [r.id, r.name as string | null]));
  const priceBy = new Map((priceRows ?? []).map((r) => [r.instrument_id, r]));
  const sectorBy = new Map((fundRows ?? []).map((r) => [r.instrument_id, r.sector as string | null]));

  // Sparklines: last SPARK_DAYS closes (dollars) per instrument.
  const sparkBy = new Map<string, number[]>();
  for (const b of barRows ?? []) {
    if (!sparkBy.has(b.instrument_id)) sparkBy.set(b.instrument_id, []);
    sparkBy.get(b.instrument_id)!.push((b.close_cents ?? 0) / 100);
  }
  for (const [k, v] of sparkBy) sparkBy.set(k, v.slice(-SPARK_DAYS));

  // Rule chips (stop / target price levels) per instrument.
  const rulesBy = new Map<string, RuleChip[]>();
  for (const r of ruleRows ?? []) {
    if (!r.instrument_id) continue;
    const p = (r.params ?? {}) as Record<string, number>;
    const chips = rulesBy.get(r.instrument_id) ?? [];
    const stop = p.stop_price_cents ?? p.stopPriceCents;
    const target = p.target_price_cents ?? p.takeProfitPriceCents ?? p.target_cents;
    if (stop) chips.push({ kind: "stop", priceCents: stop });
    if (target) chips.push({ kind: "target", priceCents: target });
    rulesBy.set(r.instrument_id, chips);
  }

  // Open thesis per instrument (latest unscored one with a target).
  const thesisBy = new Map<string, { text: string | null; target: number | null; horizon: number | null; createdAt: string; entryHint: number | null }>();
  for (const t of thesisRows ?? []) {
    const ord = t.orders as unknown as { instrument_id: string; side: string } | null;
    if (!ord?.instrument_id || t.scored_at) continue;
    const prev = thesisBy.get(ord.instrument_id);
    if (!prev || t.created_at > prev.createdAt) {
      thesisBy.set(ord.instrument_id, {
        text: t.text ?? null,
        target: t.target_price_cents ?? null,
        horizon: t.horizon_days ?? null,
        createdAt: t.created_at,
        entryHint: null,
      });
    }
  }

  const realizedBy = realizedPnlByInstrument((tradeRows ?? []) as TradeRow[]);
  const firstBuyBy = new Map<string, string>();
  for (const t of tradeRows ?? []) {
    if (t.side !== "buy") continue;
    const cur = firstBuyBy.get(t.instrument_id);
    if (!cur || t.filled_at < cur) firstBuyBy.set(t.instrument_id, t.filled_at);
  }

  const totalMv = base.positionsValueCents || 1;
  const now = Date.now();

  const holdings: HoldingRow[] = base.positions.map((p) => {
    const price = priceBy.get(p.instrumentId);
    const prevClose = price?.prev_close_cents ?? null;
    const fetchedAt = price?.fetched_at ?? null;
    const isStale = fetchedAt ? now - new Date(fetchedAt).getTime() > TTL_SECONDS * 1000 : true;
    const dayChangePct = prevClose ? ((p.markCents - prevClose) / prevClose) * 100 : null;
    const dayPnlCents = prevClose ? Math.round(p.qty * (p.markCents - prevClose)) : null;
    const th = thesisBy.get(p.instrumentId);
    const openedAt = firstBuyBy.get(p.instrumentId) ?? null;

    let thesis: ThesisStatus | null = null;
    if (th) {
      const daysHeld = openedAt ? daysBetween(openedAt, now) : 0;
      const daysRemaining = th.horizon != null ? Math.max(0, th.horizon - daysHeld) : null;
      let progressPct: number | null = null;
      let onTrack: boolean | null = null;
      if (th.target != null && p.avgCostCents) {
        const span = th.target - p.avgCostCents;
        if (span !== 0) {
          progressPct = ((p.markCents - p.avgCostCents) / span) * 100;
          onTrack = progressPct >= 0;
        }
      }
      thesis = {
        targetPriceCents: th.target,
        horizonDays: th.horizon,
        daysHeld,
        daysRemaining,
        onTrack,
        progressPct,
        text: th.text,
      };
    }

    return {
      instrumentId: p.instrumentId,
      symbol: p.symbol,
      name: nameBy.get(p.instrumentId) ?? null,
      sector: sectorBy.get(p.instrumentId) ?? null,
      qty: p.qty,
      avgCostCents: p.avgCostCents,
      lastCents: p.markCents,
      prevCloseCents: prevClose,
      marketValueCents: p.marketValueCents,
      dayChangePct,
      dayPnlCents,
      unrealizedPnlCents: p.unrealizedPnlCents,
      unrealizedPct: p.avgCostCents ? ((p.markCents - p.avgCostCents) / p.avgCostCents) * 100 : 0,
      weightPct: (p.marketValueCents / totalMv) * 100,
      realizedPnlCents: realizedBy.get(p.instrumentId) ?? 0,
      holdingDays: openedAt ? daysBetween(openedAt, now) : 0,
      spark: sparkBy.get(p.instrumentId) ?? [],
      rules: rulesBy.get(p.instrumentId) ?? [],
      thesis,
      isDelayed: p.isDelayed,
      isStale,
      fetchedAt,
    };
  });

  // Aggregates.
  const dayPnlCents = holdings.reduce((a, h) => a + (h.dayPnlCents ?? 0), 0);
  const prevEquityBase = holdings.reduce(
    (a, h) => a + (h.prevCloseCents != null ? Math.round(h.qty * h.prevCloseCents) : h.marketValueCents),
    0,
  );
  const dayPnlPct = prevEquityBase ? (dayPnlCents / prevEquityBase) * 100 : 0;

  const withDay = holdings.filter((h) => h.dayChangePct != null);
  const best = withDay.length ? withDay.reduce((a, b) => (b.dayChangePct! > a.dayChangePct! ? b : a)) : null;
  const worst = withDay.length ? withDay.reduce((a, b) => (b.dayChangePct! < a.dayChangePct! ? b : a)) : null;

  // Realized to date across the whole book (includes fully-closed names).
  const realizedTotal = [...realizedBy.values()].reduce((a, v) => a + v, 0);

  // Allocation by sector.
  const sectorTotals = new Map<string, number>();
  for (const h of holdings) {
    const key = h.sector ?? "Unclassified";
    sectorTotals.set(key, (sectorTotals.get(key) ?? 0) + h.marketValueCents);
  }
  const allocationBySector: AllocationSlice[] = [...sectorTotals.entries()]
    .map(([key, valueCents]) => ({ key, valueCents, pct: (valueCents / totalMv) * 100 }))
    .sort((a, b) => b.valueCents - a.valueCents);

  const concentrationPct = holdings.reduce((m, h) => Math.max(m, h.weightPct), 0);

  const asOf = (priceRows ?? []).reduce<string | null>(
    (min, r) => (!min || r.fetched_at < min ? r.fetched_at : min),
    null,
  );

  return {
    asOf,
    anyStale: holdings.some((h) => h.isStale),
    anyDelayed: holdings.some((h) => h.isDelayed),
    cashCents: base.cashCents,
    positionsValueCents: base.positionsValueCents,
    equityCents: base.equityCents,
    buyingPowerCents: base.cashCents, // cash-only sim: no margin
    unrealizedPnlCents: base.unrealizedPnlCents,
    realizedPnlCents: realizedTotal,
    dayPnlCents,
    dayPnlPct,
    investedPct: base.equityCents ? (base.positionsValueCents / base.equityCents) * 100 : 0,
    cashPct: base.equityCents ? (base.cashCents / base.equityCents) * 100 : 0,
    holdings,
    best,
    worst,
    armedRules: (ruleRows ?? []).filter((r) => r.status === "armed").length,
    automationEnabled: autoRow?.automation_enabled ?? false,
    allocationBySector,
    concentrationPct,
    equityCurve: (snapRows ?? []).map((s) => ({ d: s.d, equity: s.equity_cents / 100 })),
  };
}
