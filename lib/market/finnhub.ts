import type { MarketDataProvider } from "./provider";
import type { Bar, InstrumentRef, Quote } from "../types";
import { toCents } from "../money";

/**
 * Finnhub free-tier provider. IMPORTANT free-tier realities (see README/PLAN):
 *   • Quotes are delayed / last-close, NOT real-time — we set isDelayed=true.
 *   • Rate limit ~60 req/min — only the refresh-quotes cron should call this,
 *     never per-render. A minimal token-bucket guards accidental bursts.
 *
 * Daily candles on the free tier can be restricted; when unavailable the
 * caller should fall back to seeded daily_bars for backtests.
 */

const BASE = "https://finnhub.io/api/v1";

// Simple in-process rate limiter (best-effort; crons are the real guard).
let windowStart = 0;
let callsInWindow = 0;
const LIMIT_PER_MIN = 55;

async function rateLimited<T>(fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  if (now - windowStart > 60_000) {
    windowStart = now;
    callsInWindow = 0;
  }
  if (callsInWindow >= LIMIT_PER_MIN) {
    const wait = 60_000 - (now - windowStart);
    await new Promise((r) => setTimeout(r, Math.max(0, wait)));
    windowStart = Date.now();
    callsInWindow = 0;
  }
  callsInWindow++;
  return fn();
}

export class FinnhubProvider implements MarketDataProvider {
  readonly name = "finnhub";
  constructor(private apiKey = process.env.FINNHUB_API_KEY ?? "") {}

  private url(path: string, params: Record<string, string | number>): string {
    const q = new URLSearchParams({ ...params, token: this.apiKey } as Record<string, string>);
    return `${BASE}${path}?${q}`;
  }

  async getQuote(symbol: string): Promise<Quote> {
    return rateLimited(async () => {
      const res = await fetch(this.url("/quote", { symbol }));
      if (!res.ok) throw new Error(`Finnhub quote ${symbol}: ${res.status}`);
      const j = (await res.json()) as { c: number; pc: number };
      return {
        symbol,
        lastPriceCents: toCents(j.c),
        prevCloseCents: j.pc ? toCents(j.pc) : null,
        fetchedAt: new Date().toISOString(),
        isDelayed: true, // free tier is not real-time — never labeled live
        source: "finnhub",
      };
    });
  }

  async getDailyBars(symbol: string, from: Date, to: Date): Promise<Bar[]> {
    return rateLimited(async () => {
      const res = await fetch(
        this.url("/stock/candle", {
          symbol,
          resolution: "D",
          from: Math.floor(from.getTime() / 1000),
          to: Math.floor(to.getTime() / 1000),
        }),
      );
      if (!res.ok) throw new Error(`Finnhub candles ${symbol}: ${res.status}`);
      const j = (await res.json()) as {
        s: string; t: number[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[];
      };
      if (j.s !== "ok" || !j.t) return [];
      return j.t.map((ts, i) => ({
        d: new Date(ts * 1000).toISOString().slice(0, 10),
        openCents: toCents(j.o[i]),
        highCents: toCents(j.h[i]),
        lowCents: toCents(j.l[i]),
        closeCents: toCents(j.c[i]),
        volume: j.v[i] ?? 0,
      }));
    });
  }

  async searchSymbols(q: string): Promise<InstrumentRef[]> {
    return rateLimited(async () => {
      const res = await fetch(this.url("/search", { q }));
      if (!res.ok) throw new Error(`Finnhub search: ${res.status}`);
      const j = (await res.json()) as { result: { symbol: string; description: string; type: string }[] };
      return (j.result ?? [])
        .filter((r) => r.type === "Common Stock" && !r.symbol.includes("."))
        .slice(0, 15)
        .map((r) => ({ symbol: r.symbol, name: r.description }));
    });
  }
}

let _provider: MarketDataProvider | null = null;
/** Single swap point for the whole app. */
export function getMarketDataProvider(): MarketDataProvider {
  if (!_provider) _provider = new FinnhubProvider();
  return _provider;
}
