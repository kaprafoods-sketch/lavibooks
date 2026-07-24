import type { Bar, InstrumentRef, Quote } from "../types";

/**
 * The ONLY interface the app knows about for market data. Swap vendors by
 * changing which implementation `getMarketDataProvider()` returns — one file.
 *
 * The app must never call a provider during render. A cron populates
 * price_cache; pages read the cache. See lib/market/finnhub.ts.
 */
export interface MarketDataProvider {
  readonly name: string;
  getQuote(symbol: string): Promise<Quote>;
  getDailyBars(symbol: string, from: Date, to: Date): Promise<Bar[]>;
  searchSymbols(q: string): Promise<InstrumentRef[]>;
}
