# Lavi Books — Paper Trading Platform

A Vested-style **paper-trading** app for US equities (NYSE/NASDAQ) with a
prediction/learning layer and an algorithm sandbox. Virtual money only — no real
execution, no margin, no shorting. Branded as **LV / Lavi Books** (luxe dark theme).

- **Phase 1** (built): auth, portfolios, market data, order engine, ledger,
  FIFO positions, P&L, equity curve, thesis capture + scoring, SMA backtester.
- **Phase 2** (schema + interfaces only): org → advisor → client hierarchy,
  block allocation, roles, audit log, RLS — no UI.

## Stack
Next.js 15 (App Router) · TypeScript · Tailwind · Supabase (Postgres + Auth +
RLS + Edge Functions) · Recharts · Finnhub (free tier, swappable). Deploy: Vercel.

## Architecture principles
- **Money is integer cents** everywhere (`bigint`). No floats on money paths.
- **Cash balance is derived** from `cash_ledger` — never a mutable column.
- **FIFO lots** for realized P&L; **weighted-average cost** for display.
- **The vendor is never called during render.** A cron writes `price_cache`;
  pages read the cache. Quotes on the free tier are **delayed** and labeled so.
- The market-data vendor lives behind `MarketDataProvider` — swap in one file
  (`lib/market/finnhub.ts`).

## Setup

1. **Install**
   ```bash
   pnpm install
   ```

2. **Create a Supabase project**, then copy env:
   ```bash
   cp .env.example .env.local
   ```
   Fill in `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, and `FINNHUB_API_KEY`.

3. **Apply the schema** (SQL editor or `supabase db push`):
   ```
   supabase/migrations/0001_init.sql        -- tables
   supabase/migrations/0002_rls.sql         -- Phase-1 RLS (owner-scoped)
   supabase/migrations/0003_phase2_rls.sql  -- Phase-2 org/advisor policies
   ```

4. **Seed** — demo user, $100,000 virtual cash, ~20 sample trades with theses,
   instruments, cached prices, ~180 days of daily bars, EOD snapshots:
   ```bash
   pnpm seed
   ```
   Demo login: `demo@lavibooks.test` / `lavibooks-demo-123`.

5. **Run**
   ```bash
   pnpm dev
   ```

6. **Deploy the Edge crons** (Supabase) and schedule them:
   - `refresh-quotes` — every minute during market hours → `price_cache` (TTL).
   - `match-orders` — every minute → fills pending limit/stop + queued market.
   - `eod-snapshot` — once daily after close → equity-curve snapshots.
   ```bash
   supabase functions deploy refresh-quotes
   supabase functions deploy match-orders
   supabase functions deploy eod-snapshot
   ```

## Tests (money paths — mandatory)
```bash
pnpm test
```
Covers: derived ledger balance, buying-power rejection, slippage, FIFO lot
consumption + realized P&L, weighted-average cost, commission, market/limit/stop
triggering, thesis scoring, backtest metrics (CAGR/DD/Sharpe/win-rate), and
Phase-2 block allocation. **31 tests.**

## Known gaps / honest status
- Finnhub free tier = **delayed** quotes (labeled), ~60 req/min, **daily bars
  only** → backtests are EOD-resolution. Not real-time; we never ship delayed
  data as live.
- Fills are **simulated** (last price ± slippage), not order-book matched.
- **No shorting / margin / fractional shares** in v1.
- The order server action is not yet a single DB transaction (documented gap);
  the `match-orders` cron fills cash + trade but defers full FIFO lot rebuild to
  the app path — reuse a shared RPC before relying on cron fills for cost basis.
- NYSE holiday table is static — update yearly.

## Phase 2 legal surface (flagged, not addressed)
Phase 2 manages real client portfolios in India: **SEBI RIA/RA registration**,
**client agreements**, and **DPDP Act 2023** obligations attach before that phase
begins. See `PLAN.md §8`. Phase 1 (virtual, single self-directed user) does not
trigger these.
