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

**Status: Phase 1 plan complete.** The automation add-on design follows below.

---
---

# ADD-ON MILESTONE (M7) — Rules-Based Trade Automation

> Orders that place and exit themselves from **stored, versioned Rules** —
> evaluated by a scheduled worker, editable in the UI without a deploy.
> Everything stays paper-money inside `PaperBroker`. No real execution.
>
> Design only. **No code until this section is approved (working agreement §1).**

## M7.0 Principles that shape every decision below

1. **Rules are data, not code.** A `Rule` row + a `params` jsonb blob. The worker
   is a generic evaluator; adding a rule type means a new params shape + a pure
   evaluator function, never a schema migration per rule.
2. **Immutable history.** A rule is never mutated on trigger. Every evaluation
   appends a `rule_event`; the rule's `status` transitions via a state machine.
3. **Fail CLOSED.** Vendor error, stale price (>15 min), missing position, or any
   ambiguous state → write `blocked` with a reason, emit nothing.
4. **Idempotent by construction.** Every trigger carries a unique key
   `(rule_id, trigger_bar_ts)`. A duplicate cron tick can physically not insert a
   second event or order for the same bar. Advisory locks serialize per-rule.
5. **Realism over convenience.** A stop is a *trigger*, not a fill price. Gaps
   fill at the open and the gap slippage is recorded. We never imply intraday
   precision the free tier can't give.

## M7.1 Schema DDL

```sql
-- Rule status state machine:
--   draft → armed → triggered → completed
--                 ↘ expired | cancelled | error
-- 'simulate' is NOT a status — it is a mode (see automation_settings + rules.mode)
-- so a rule can be armed-but-dry-running.

create type rule_type as enum (
  'bracket_oco', 'stop_loss', 'take_profit',
  'conditional_entry', 'scheduled', 'time_stop'
);
create type rule_status as enum (
  'draft','armed','triggered','completed','expired','cancelled','error'
);
create type rule_mode as enum ('simulate','live');

create table rules (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  instrument_id uuid references instruments(id),        -- null for portfolio-wide (EOD flatten)
  type rule_type not null,
  mode rule_mode not null default 'simulate',           -- dry-run first, always
  params jsonb not null,                                 -- shape per type, see M7.2
  status rule_status not null default 'draft',
  -- OCO linkage: the two legs of a bracket reference each other.
  parent_rule_id uuid references rules(id) on delete cascade,
  oco_group_id uuid,                                     -- both legs share this
  -- Trailing state (high-water mark) lives here, updated append-safely.
  hwm_cents bigint,                                      -- highest close since entry
  entry_price_cents bigint,                              -- captured when armed/attached
  entry_trade_id uuid references trades(id),
  valid_from timestamptz,
  valid_until timestamptz,
  version int not null default 1,                        -- bumped on every edit
  supersedes_rule_id uuid references rules(id),          -- edit = new version row
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);
create index on rules (portfolio_id, status);
create index on rules (instrument_id, status);
create index on rules (oco_group_id);

-- Append-only evaluation log. Every tick that touches a rule writes one row.
create table rule_events (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references rules(id) on delete cascade,
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  evaluated_at timestamptz not null default now(),
  trigger_bar_ts timestamptz not null,                  -- the bar/tick identity
  market_price_cents bigint,
  price_is_stale boolean not null default false,
  decision text not null check (decision in ('no_trigger','triggered','blocked')),
  reason_text text not null,
  resulting_order_id uuid references orders(id),
  gap_slippage_cents bigint,                             -- explicit gap fill cost
  -- IDEMPOTENCY: at most one *triggered* event per (rule, bar).
  unique (rule_id, trigger_bar_ts, decision)
);
create index on rule_events (rule_id, evaluated_at desc);
create index on rule_events (portfolio_id, evaluated_at desc);

-- Per-portfolio risk rails + kill switch.
create table automation_settings (
  portfolio_id uuid primary key references portfolios(id) on delete cascade,
  automation_enabled boolean not null default false,    -- global kill switch (false = all disarmed)
  killed_at timestamptz,                                 -- set when kill switch thrown
  killed_by uuid references profiles(id),
  max_daily_loss_cents bigint,                           -- breach disarms for the session
  max_open_positions int,
  max_position_pct numeric(5,2),                         -- % of portfolio equity
  max_automated_orders_per_day int,
  daily_loss_breached_on date,                           -- set by worker on breach
  partial_fill_enabled boolean not null default false,
  partial_fill_adv_pct numeric(5,2) default 5.0,         -- order > this % of ADV → split
  updated_at timestamptz not null default now()
);

-- Orders/trades gain automation provenance (nullable = manual).
alter table orders add column rule_id uuid references rules(id);
alter table orders add column automated boolean not null default false;
alter table trades add column rule_id uuid references rules(id);
alter table trades add column gap_slippage_cents bigint;   -- explicit, when gap-filled
```

RLS: `rules`, `rule_events`, `automation_settings` all gate through
`owns_portfolio(portfolio_id)` — same helper Phase 1/2 already use, so advisor
access in Phase 2 comes for free.

## M7.2 `params` jsonb shape per rule type

All prices are **cents**. All percentages are plain numbers (`5` = 5%).
Every evaluator is a pure function `(rule, quote, ctx) → Decision` unit-tested in
isolation; the shapes below are validated with a zod schema per type at write time.

```jsonc
// 1) bracket_oco — attached to an open long position (qty shares).
//    Materializes as TWO child rules (a take_profit leg + a stop_loss leg)
//    sharing one oco_group_id. First to trigger fills; sibling → cancelled.
{ "qty": 40,
  "take_profit": { "mode": "absolute", "price_cents": 25000 },   // or {mode:"pct_gain", pct:15} or {mode:"r_multiple", r:2}
  "stop_loss":   { "mode": "pct_below_entry", "pct": 5 } }       // shapes below

// 2) stop_loss
{ "qty": 40,
  "trigger": { "mode": "absolute", "price_cents": 17840 } }
// or { "mode": "pct_below_entry", "pct": 5 }
// or { "mode": "trailing_pct", "pct": 8 }          // vs highest close since entry (hwm_cents)

// 3) take_profit
{ "qty": 40,
  "trigger": { "mode": "absolute", "price_cents": 25000 } }
// or { "mode": "pct_gain", "pct": 20 }
// or { "mode": "r_multiple", "r": 2, "initial_risk_cents": 1200 }   // 2× the entry risk

// 4) conditional_entry — opens a position.
{ "side": "buy", "qty": 20,
  "trigger": { "mode": "cross_above", "price_cents": 22000 } }   // or cross_below
// or { "mode": "strategy", "strategy": "sma_crossover", "fast": 20, "slow": 50 }

// 5) scheduled
{ "action": "place_at_open", "side": "buy", "qty": 10 }
// or { "action": "eod_flatten", "minutes_before_close": 15 }    // instrument_id null ⇒ whole portfolio

// 6) time_stop — exit unconditionally after N *trading* days.
{ "qty": 40, "trading_days": 5 }
```

**Cross detection** needs prior state: we compare the current close against the
previous evaluated close stored on the last `rule_event` (or the prior daily
bar) — a cross fires only on the bar where it actually crosses, never every bar
above the line.

## M7.3 Evaluation flow (Edge Function on cron)

```
Cadence A: every 1 min during NYSE RTH  → all armed price-driven rules
Cadence B: once at open, once ~T-15 close → scheduled rules
                                                                            
for each cron tick:
  acquire per-portfolio advisory lock (pg_try_advisory_lock) ─ skip if held
  load automation_settings
  ├─ if !automation_enabled → write no rule_events, exit (kill switch)
  └─ if daily_loss_breached_on == today → all rules blocked, exit
  load armed rules for portfolio (+ portfolio-wide scheduled)
  batch-fetch quotes: ONE vendor call per UNIQUE symbol (never per rule)
  compute trigger_bar_ts = latest bar timestamp (identity for idempotency)
  for each rule (deterministic order; brackets before their legs):
    guard: price stale >15min? vendor error? → rule_event(blocked, reason); continue
    decision = pureEvaluate(rule, quote, ctx)     ← the only rule-type-specific code
    if decision == no_trigger → rule_event(no_trigger); update hwm if trailing
    if decision == triggered:
      ── BEGIN TRANSACTION ──
        INSERT rule_event(triggered, trigger_bar_ts)   ← UNIQUE(rule,bar,decision) = idempotency guard
        run safety rails (buying power, max positions, size %, orders/day)
          fail → ROLLBACK to a blocked event instead; continue
        convert to market order, fill via PaperBroker engine (gap-aware price)
        write order(rule_id, automated=true) + trade(+gap_slippage) + ledger + lots + position
        transition rule.status → triggered/completed
        if OCO: cancel sibling leg (status → cancelled) in the SAME tx
      ── COMMIT ──   (duplicate tick hits the UNIQUE constraint → no-op)
  release advisory lock
```

Gap handling lives in the fill step: if `prev_close > stop` and `today_open <
stop` (sell stop), fill at `open`, not `stop`; `gap_slippage_cents = stop - open`
recorded on the trade and event. Limit orders fill only if the bar's range
actually trades through the limit.

**Mode gate:** a rule in `simulate` mode runs the whole pipeline *except* the
transaction body — it writes the `rule_event` (decision + reason) and stops. No
order, no ledger, no status change. That's the dry run.

## M7.4 Safety rails (enforced before any automated order)

| Rail | Enforcement point | On breach |
|---|---|---|
| Global kill switch (`automation_enabled`) | top of tick | disarm all, log killed_by/at |
| Max daily loss | top of tick + pre-order | set `daily_loss_breached_on`, block rest of session |
| Max open positions | pre-order | block, reason |
| Max position size % | pre-order | block, reason |
| Max automated orders/day | pre-order (count today's automated orders) | block, reason |
| Buying power | pre-order (reuse `checkBuyingPower`) | block, reason |
| Stale price >15 min | guard, before evaluate | block, reason |
| Vendor error / missing position | guard | block, reason |

Every block is a `rule_event(blocked, reason_text)` — nothing the system declines
is silent. Kill switch is one `automation_settings.automation_enabled=false`
UPDATE, reachable in one tap from anywhere in the UI.

## M7.5 Dry-run + Rule backtester

- **Simulate mode** (above) is the default for every new rule — you watch
  `rule_events` for a few sessions before flipping `mode → live`.
- **Rule backtester** reuses the M5 runner over historical `daily_bars`: replays
  each bar, evaluates the rule config, and reports **trigger count, win rate, avg
  gain/loss, max drawdown, and the exact dates it would have fired**. Trailing
  stops recompute HWM from daily closes (stated as EOD-resolution).
- **Small-sample warning:** < 20 triggers → the UI banners "sample too small to
  be meaningful" and suppresses win-rate bravado.

## M7.6 Prediction-layer tie-in

- Every automated order/trade carries `rule_id` → provenance.
- Dashboard **manual vs automated** cohort compare: hit rate, avg P&L, avg
  holding period, worst drawdown, side by side.
- **Stop analytics** — the headline question, computed both ways:
  - *Stops that saved me*: stop-loss fills where the instrument's price
    continued **below** the fill over the horizon (loss avoided).
  - *Stops that shook me out*: stop-loss fills where price **recovered above** the
    fill within the horizon (opportunity cost). Counterfactual reuses daily bars.

## M7.7 UI

| Surface | Content |
|---|---|
| Rule builder | Params form + an always-visible **plain-language summary** generated from params: *"Sell all 40 shares of AAPL if price drops below $178.40 — 5% below your entry — good until Aug 30."* Mode toggle (Simulate/Live) defaults Simulate. |
| Rules list | Status chips, mode badge, next evaluation time, per-rule event-log drawer |
| Activity feed | Every automated action: timestamp, trigger price, reason, resulting order — nothing unexplainable after the fact |
| Kill switch | Persistent one-tap control in the header; confirmation + who/when log |
| Backtest panel | Trigger dates, metrics, small-sample warning |

Route additions: `/rules` (list + builder), `/rules/[id]` (event log + backtest),
Edge fn `evaluate-rules` (cadence A) reusing `scheduled` handling for cadence B.

## M7.8 Tests (mandatory — pure evaluators + integration)

1. **Bracket OCO** — TP leg triggers → SL sibling transitions to `cancelled`, no
   orphan order remains; and the reverse.
2. **Gap-down through a stop** — prev close > stop, open < stop → fill at **open**,
   `gap_slippage_cents` recorded, not filled at stop.
3. **Trailing stop ratchets** — HWM rises with new highs, never decreases; trigger
   uses the ratcheted level.
4. **Duplicate cron tick** — same `trigger_bar_ts` evaluated twice → exactly one
   triggered event + one order (UNIQUE constraint / idempotency).
5. **Daily-loss breach** — crossing max daily loss disarms rules and blocks every
   subsequent order that session (`blocked` events).
6. **Stale price** — quote > 15 min old → `blocked`, no fill.
7. **Insufficient buying power** — automated buy rejects cleanly, logs `blocked`.
8. Time-stop exits after exactly N trading days; conditional cross fires only on
   the crossing bar; kill switch halts mid-batch.

## M7.9 Risks / honest gaps

1. **EOD resolution.** Free-tier daily bars mean intraday triggers are evaluated
   against the latest available (delayed) quote and daily OHLC. Trailing stops
   and gap logic are **daily-close precision** — the UI states this; we do not
   imply intraday fills.
2. **Cron granularity vs "1-minute" spec.** Supabase cron is minute-level at best
   and quotes are delayed — real 1-min intrabar precision is not achievable on
   the free tier. Documented, not faked.
3. **Advisory-lock + UNIQUE constraint** are the two independent idempotency
   guards; if a tick dies mid-transaction the COMMIT never lands and the next
   tick retries cleanly (the triggered event only exists if the tx committed).
4. **Partial fills** are heuristic (order vs ADV%), off by default, and not a
   microstructure model.
5. **R-multiple / initial risk** must be captured at arm time; if a bracket is
   attached without a recorded entry risk, `r_multiple` modes are rejected at
   validation rather than guessed.
6. Same **static NYSE holiday table** dependency as Phase 1.

## M7.10 Out of scope (per spec)

Real-broker execution, options, margin, shorting, ML-generated signals, and any
rule keyed on news/sentiment.

---

**Status: M7 automation design complete. Stopping for review before any build
(per working agreement §1).**
