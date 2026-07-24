# Lavi Books — Architecture & Build Plan

> **Lavi Books** — a Vested-style paper-trading platform for US equities with a
> prediction/learning layer, an algorithm sandbox, and a Phase-2 multi-client
> CRM data model. Branded end-to-end as **LV** (monogram, deep-luxe dark theme).
>
> This is the planning artifact required by the working agreement. It covers
> architecture, schema DDL, route map, milestones, and open questions/risks.
> **No application code is built until this plan is reviewed.**

---

## 0. Stated defaults & decisions (I picked these; flag if you disagree)

| Decision | Choice | Rationale |
|---|---|---|
| Framework | Next.js 15 App Router + TS + Tailwind | Per brief |
| Backend | Supabase (Postgres + Auth + RLS + Edge Functions) | Per brief |
| Market data | Finnhub free tier, wrapped in `MarketDataProvider` | Per brief; swappable in one file |
| Charts | `lightweight-charts` for price/equity, Recharts for dashboard analytics | TradingView charts are best for OHLC; Recharts easier for bar/pie analytics |
| Money | `bigint` cents everywhere; quantities `numeric(20,8)` | No floats on money paths |
| Quantities | Whole-share only in v1 (scale kept at 8 for future fractional) | US equities; keeps FIFO simple |
| Fill model | Fill at last trade price ± slippage (default **5 bps**), commission **$0** | Configurable in `sim_config` |
| Order types | MARKET, LIMIT, STOP | Per brief; no STOP-LIMIT in v1 |
| Market calendar | `nyse` via a static holiday table + hours logic; orders outside RTH queue to next open | Free-tier friendly, deterministic |
| Data freshness | Quotes are **delayed/last-close on free tier** — labeled as such in UI | Honesty constraint; see §8 |
| Package manager | pnpm | Fast, Vercel-friendly |
| Tests | Vitest + testing on all money paths | Per brief |
| ID strategy | `uuid` PKs, `gen_random_uuid()` | Supabase default |

**Non-negotiables encoded in schema:** balance is derived from `cash_ledger`
(no mutable balance column); every cash movement is a ledger row; FIFO lots for
realized P&L; weighted-average cost for display.

---

## 1. High-level architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Next.js 15 (Vercel)                                         │
│  • App Router pages (RSC) — dashboard, trade, portfolio,     │
│    dashboard/learning, backtest                              │
│  • Route Handlers (/api/*) — order submit, backtest run      │
│  • Server Actions for mutations                              │
│  • lib/ — domain engine (pure, unit-tested)                  │
│      market/      MarketDataProvider + FinnhubProvider       │
│      engine/      order matching, fills, FIFO lots, P&L      │
│      ledger/      cash ledger + buying-power                 │
│      calendar/    NYSE hours + holidays                      │
│      scoring/     thesis scoring                             │
│      backtest/    Strategy interface + SMA + runner          │
│      broker/      BrokerAdapter + PaperBroker (Phase 2 stub) │
└───────────────┬─────────────────────────────────────────────┘
                │ supabase-js (RLS-enforced)
┌───────────────▼─────────────────────────────────────────────┐
│  Supabase                                                    │
│  • Postgres (all tables below) + RLS                         │
│  • Auth (email magic-link)                                   │
│  • Edge Functions (cron):                                    │
│      refresh-quotes   — poll Finnhub → price_cache (TTL)     │
│      match-orders     — fill pending LIMIT/STOP + queued      │
│      eod-snapshot     — daily equity-curve snapshot          │
└──────────────────────────────────────────────────────────────┘
```

**Golden rule:** the vendor is never called during render. Pages read
`price_cache`; a cron Edge Function is the only writer of fresh quotes.

---

## 2. Domain model (schema DDL)

All money is `bigint` cents. All tables have `created_at timestamptz default now()`.
Phase-2 columns exist from day one (nullable) so Phase 1 is not a rewrite.

```sql
-- ORGS (Phase 2 stub — present now for RLS scoping)
create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- PROFILES (1:1 with auth.users)
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid references orgs(id),                 -- Phase 2
  role text not null default 'client'              -- owner|advisor|read_only|client
    check (role in ('owner','advisor','read_only','client')),
  display_name text,
  base_currency text not null default 'USD',
  created_at timestamptz not null default now()
);

-- PORTFOLIOS (a user/client can have many; algo results get their own)
create table portfolios (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  org_id uuid references orgs(id),                 -- Phase 2
  client_id uuid references profiles(id),          -- Phase 2 (advisor manages client)
  name text not null,
  kind text not null default 'manual'              -- manual|algo
    check (kind in ('manual','algo')),
  base_currency text not null default 'USD',
  created_at timestamptz not null default now()
);

-- INSTRUMENTS (US equities)
create table instruments (
  id uuid primary key default gen_random_uuid(),
  symbol text not null unique,
  name text,
  exchange text,                                    -- NYSE|NASDAQ
  currency text not null default 'USD',
  is_active boolean not null default true
);

-- CASH LEDGER (balance is DERIVED = sum(amount_cents) where portfolio)
create table cash_ledger (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  amount_cents bigint not null,                     -- +deposit/sale, -purchase/fee
  reason text not null,                             -- deposit|buy|sell|commission|adjustment
  ref_trade_id uuid,                                -- links to trades.id when applicable
  created_at timestamptz not null default now()
);

-- ORDERS (intent) — status machine
create table orders (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  instrument_id uuid not null references instruments(id),
  side text not null check (side in ('buy','sell')),
  type text not null check (type in ('market','limit','stop')),
  qty numeric(20,8) not null check (qty > 0),
  limit_price_cents bigint,                          -- for limit
  stop_price_cents bigint,                           -- for stop
  status text not null default 'pending'
    check (status in ('pending','partial','filled','cancelled','rejected')),
  filled_qty numeric(20,8) not null default 0,
  reject_reason text,
  queued_for_open boolean not null default false,    -- placed outside RTH
  created_at timestamptz not null default now()
);

-- TRADES (executions/fills; an order may have several partials)
create table trades (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  instrument_id uuid not null references instruments(id),
  side text not null check (side in ('buy','sell')),
  qty numeric(20,8) not null check (qty > 0),
  price_cents bigint not null,                        -- fill price incl. slippage
  commission_cents bigint not null default 0,
  filled_at timestamptz not null default now()
);

-- LOTS (FIFO cost basis; a buy opens a lot, a sell consumes lots FIFO)
create table lots (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  instrument_id uuid not null references instruments(id),
  open_trade_id uuid not null references trades(id),
  qty_open numeric(20,8) not null,                   -- remaining qty in the lot
  qty_original numeric(20,8) not null,
  cost_cents bigint not null,                         -- per-share cost basis (cents)
  opened_at timestamptz not null default now()
);

-- POSITIONS (denormalized cache; derivable from lots — rebuilt on each fill)
create table positions (
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  instrument_id uuid not null references instruments(id),
  qty numeric(20,8) not null default 0,
  avg_cost_cents bigint not null default 0,          -- weighted-average for display
  primary key (portfolio_id, instrument_id)
);

-- PRICE CACHE (only writer = refresh-quotes cron; TTL enforced by fetched_at)
create table price_cache (
  instrument_id uuid primary key references instruments(id) on delete cascade,
  last_price_cents bigint not null,
  prev_close_cents bigint,
  fetched_at timestamptz not null default now(),
  source text not null default 'finnhub',
  is_delayed boolean not null default true
);

-- DAILY BARS (history for backtests)
create table daily_bars (
  instrument_id uuid not null references instruments(id) on delete cascade,
  d date not null,
  open_cents bigint, high_cents bigint, low_cents bigint, close_cents bigint,
  volume bigint,
  primary key (instrument_id, d)
);

-- THESES (prediction/learning layer; optional per order)
create table theses (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  text text,
  target_price_cents bigint,
  horizon_days int,
  conviction int check (conviction between 1 and 5),
  tags text[] default '{}',                           -- sector/setup/source
  -- scoring (filled on close)
  scored_at timestamptz,
  target_hit boolean,
  realized_pnl_cents bigint,
  predicted_pnl_cents bigint,
  created_at timestamptz not null default now()
);

-- WATCHLISTS
create table watchlists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  instrument_ids uuid[] default '{}'
);

-- SNAPSHOTS (EOD equity curve; stored, not recomputed)
create table snapshots (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  d date not null,
  cash_cents bigint not null,
  positions_value_cents bigint not null,
  equity_cents bigint not null,                       -- cash + positions
  unique (portfolio_id, d)
);

-- SIM CONFIG (per-portfolio fill simulation knobs)
create table sim_config (
  portfolio_id uuid primary key references portfolios(id) on delete cascade,
  slippage_bps int not null default 5,
  commission_cents bigint not null default 0
);

-- AUDIT LOG (Phase 2, but wired now on every state change)
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references profiles(id),
  org_id uuid references orgs(id),
  entity text not null, entity_id uuid,
  action text not null,                               -- create|update|fill|cancel|...
  diff jsonb,
  created_at timestamptz not null default now()
);
```

**RLS posture (Phase 1):** every row filtered by `owner_id = auth.uid()` (via
portfolio ownership). **Phase 2** swaps/adds `org_id`-scoped policies:
advisors see portfolios where `org_id` matches and role in (owner, advisor);
clients see only their own. Policies written as helper SQL functions so the
Phase-1 → Phase-2 switch is additive, not a rewrite.

---

## 3. Core engine contracts (pure, unit-tested)

```ts
interface MarketDataProvider {
  getQuote(symbol: string): Promise<Quote>;          // last, prevClose, delayed?
  getDailyBars(symbol: string, from: Date, to: Date): Promise<Bar[]>;
  searchSymbols(q: string): Promise<InstrumentRef[]>;
}

interface BrokerAdapter {                             // Phase 2 seam
  submit(order: OrderIntent): Promise<Fill[]>;
}                                                     // only PaperBroker in v1

interface Strategy {                                  // backtest sandbox
  readonly name: string;
  onBar(ctx: BacktestContext, bar: Bar): Signal | null;  // buy|sell|hold
}
```

Engine functions (all cents-in / cents-out, no I/O):
`priceWithSlippage()`, `checkBuyingPower()`, `applyFill()` (opens/consumes FIFO
lots, writes ledger rows, rebuilds position), `realizedPnlFIFO()`,
`weightedAvgCost()`, `scoreThesis()`.

---

## 4. Route map

| Route | Type | Purpose |
|---|---|---|
| `/login` | page | Magic-link auth |
| `/` (dashboard) | RSC | Equity curve, positions, P&L summary |
| `/trade` | RSC + action | Symbol search, quote, order ticket + thesis |
| `/portfolio/[id]` | RSC | Positions, lots, orders, trade blotter |
| `/orders` | RSC | Order history + status |
| `/learning` | RSC | Hit rate by tag/conviction/sector; best/worst; counterfactual |
| `/backtest` | RSC + action | Pick symbol + strategy → equity curve, CAGR, DD, Sharpe, win rate |
| `/watchlists` | RSC | Manage watchlists |
| `/api/orders` | route handler | Submit order (server-validated) |
| `/api/backtest` | route handler | Run backtest job |
| Edge: `refresh-quotes` | cron | Finnhub → price_cache (TTL) |
| Edge: `match-orders` | cron | Fill pending limit/stop + queued-open |
| Edge: `eod-snapshot` | cron | Write daily snapshots |

---

## 5. Milestones (each independently runnable)

- **M1 — Auth + portfolio + market data.** Supabase project, migrations, RLS,
  magic-link login, `MarketDataProvider`/`FinnhubProvider`, `price_cache` +
  `refresh-quotes` cron, symbol search, quote panel. `.env.example` + README.
- **M2 — Order engine + ledger + positions.** Order ticket → validation →
  buying-power check → `PaperBroker` fill → trades, FIFO lots, ledger rows,
  positions rebuild. `match-orders` cron for limit/stop + queued-open. **Vitest
  on all money paths.**
- **M3 — P&L + charts + dashboard.** Realized/unrealized P&L, weighted-avg cost
  UI, equity curve (`eod-snapshot`), lightweight-charts price view.
- **M4 — Thesis capture + scoring.** Thesis on order entry; auto-score on close;
  `/learning` analytics.
- **M5 — Backtester.** `Strategy` + SMA crossover + runner (CAGR, max DD, win
  rate, Sharpe) writing to a separate `kind='algo'` portfolio.
- **M6 — Phase-2 schema + RLS.** Org hierarchy policies, bulk-allocation
  interfaces (pro-rata/equal/custom), roles, audit log wiring. **Schema +
  interfaces only, no UI.**

Seed script (from M1): demo user, $100,000 virtual cash, ~20 sample trades with
theses so the app is never empty on first run.

---

## 6. Testing (mandatory money-path coverage)

Vitest suites: ledger balance derivation; buying-power rejection; slippage math;
FIFO lot consumption + realized P&L across partial sells; weighted-avg cost;
commission; snapshot equity math; thesis scoring; backtest metrics
(CAGR/DD/Sharpe on a known series).

---

## 7. Branding (LV / Lavi Books)

Mobile-first, dark, dense-but-readable. Deep charcoal + a single luxe accent
(champagne-gold) + monospaced tabular numerals for all money. Consistent
gain = emerald, loss = rose. `LV` monogram mark. No real trademark misuse — this
is an original "LV / Lavi Books" luxe-inspired identity, not a real fashion
house's assets.

---

## 8. Open questions / risks / honest gaps

1. **Finnhub free tier is delayed / rate-limited (60 req/min).** No real-time
   intraday. **Workaround:** quotes are last-trade/last-close, TTL-cached, and
   the UI labels them "Delayed" with the fetch timestamp. We do **not** ship
   delayed data as live.
2. **Fills are simulated**, not exchange-matched — last price ± slippage. No
   order-book depth, no realistic partial-fill microstructure.
3. **Daily bars only** for history (free tier) → backtests are EOD-resolution.
4. **No shorting / margin / fractional shares** in v1 (flagged future work).
5. **NYSE calendar** uses a maintained static holiday table; early-close days
   (half-days) handled but must be updated yearly.
6. **Sharpe** uses a chosen risk-free rate assumption (default 0%) and daily
   returns — documented, not audited.
7. **Secrets:** Finnhub key + Supabase service role live in env only;
   `.env.example` ships, real values never committed.

### Legal surface (PLAN.md note only — not acted on, flagged for scoping)

Phase 2 manages **real client portfolios in India**. Before Phase 2 begins,
legal review should scope where these attach:

- **SEBI RIA/RA registration** — advising on / managing client securities for a
  fee likely triggers Investment Adviser / Research Analyst regulation.
- **Client agreements** — advisory contracts, risk disclosures, fee terms.
- **DPDP Act 2023** — personal + financial data of clients: consent, purpose
  limitation, storage, and breach obligations.

Phase 1 (virtual money, single self-directed user) does **not** trigger these —
but the moment real client money and advice enter (Phase 2), they do. Surface
area flagged; no legal advice given here.

---

**Status: plan complete. Stopping for review before any build (per working
agreement §1).**
