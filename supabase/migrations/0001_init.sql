-- Lavi Books — initial schema.
-- Money is bigint cents. Balances are DERIVED from cash_ledger, never stored.
-- Phase-2 columns (org_id, client_id, roles, audit) exist now as nullable so
-- Phase 1 is not a rewrite later.

create extension if not exists pgcrypto;

-- ── Phase-2 stub: orgs ───────────────────────────────────────────────────────
create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- ── profiles (1:1 with auth.users) ───────────────────────────────────────────
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid references orgs(id),
  role text not null default 'client'
    check (role in ('owner','advisor','read_only','client')),
  display_name text,
  base_currency text not null default 'USD',
  created_at timestamptz not null default now()
);

-- ── portfolios ───────────────────────────────────────────────────────────────
create table portfolios (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  org_id uuid references orgs(id),
  client_id uuid references profiles(id),
  name text not null,
  kind text not null default 'manual' check (kind in ('manual','algo')),
  base_currency text not null default 'USD',
  created_at timestamptz not null default now()
);
create index on portfolios (owner_id);

-- ── instruments ──────────────────────────────────────────────────────────────
create table instruments (
  id uuid primary key default gen_random_uuid(),
  symbol text not null unique,
  name text,
  exchange text,
  currency text not null default 'USD',
  is_active boolean not null default true
);

-- ── cash_ledger (balance = sum(amount_cents)) ────────────────────────────────
create table cash_ledger (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  amount_cents bigint not null,
  reason text not null check (reason in ('deposit','buy','sell','commission','adjustment')),
  ref_trade_id uuid,
  created_at timestamptz not null default now()
);
create index on cash_ledger (portfolio_id);

-- ── orders (status machine) ──────────────────────────────────────────────────
create table orders (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  instrument_id uuid not null references instruments(id),
  side text not null check (side in ('buy','sell')),
  type text not null check (type in ('market','limit','stop')),
  qty numeric(20,8) not null check (qty > 0),
  limit_price_cents bigint,
  stop_price_cents bigint,
  status text not null default 'pending'
    check (status in ('pending','partial','filled','cancelled','rejected')),
  filled_qty numeric(20,8) not null default 0,
  reject_reason text,
  queued_for_open boolean not null default false,
  created_at timestamptz not null default now()
);
create index on orders (portfolio_id, status);

-- ── trades (fills) ───────────────────────────────────────────────────────────
create table trades (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  instrument_id uuid not null references instruments(id),
  side text not null check (side in ('buy','sell')),
  qty numeric(20,8) not null check (qty > 0),
  price_cents bigint not null,
  commission_cents bigint not null default 0,
  filled_at timestamptz not null default now()
);
create index on trades (portfolio_id);

-- ── lots (FIFO cost basis) ───────────────────────────────────────────────────
create table lots (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  instrument_id uuid not null references instruments(id),
  open_trade_id uuid not null references trades(id),
  qty_open numeric(20,8) not null,
  qty_original numeric(20,8) not null,
  cost_cents bigint not null,
  opened_at timestamptz not null default now()
);
create index on lots (portfolio_id, instrument_id);

-- ── positions (denormalized cache, rebuilt on each fill) ─────────────────────
create table positions (
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  instrument_id uuid not null references instruments(id),
  qty numeric(20,8) not null default 0,
  avg_cost_cents bigint not null default 0,
  primary key (portfolio_id, instrument_id)
);

-- ── price_cache (only writer = refresh-quotes cron; TTL via fetched_at) ──────
create table price_cache (
  instrument_id uuid primary key references instruments(id) on delete cascade,
  last_price_cents bigint not null,
  prev_close_cents bigint,
  fetched_at timestamptz not null default now(),
  source text not null default 'finnhub',
  is_delayed boolean not null default true
);

-- ── daily_bars (history for backtests) ───────────────────────────────────────
create table daily_bars (
  instrument_id uuid not null references instruments(id) on delete cascade,
  d date not null,
  open_cents bigint, high_cents bigint, low_cents bigint, close_cents bigint,
  volume bigint,
  primary key (instrument_id, d)
);

-- ── theses (prediction/learning layer) ───────────────────────────────────────
create table theses (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  text text,
  target_price_cents bigint,
  horizon_days int,
  conviction int check (conviction between 1 and 5),
  tags text[] default '{}',
  scored_at timestamptz,
  target_hit boolean,
  realized_pnl_cents bigint,
  predicted_pnl_cents bigint,
  created_at timestamptz not null default now()
);
create index on theses (portfolio_id);

-- ── watchlists ───────────────────────────────────────────────────────────────
create table watchlists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  instrument_ids uuid[] default '{}'
);

-- ── snapshots (EOD equity curve; stored, not recomputed) ─────────────────────
create table snapshots (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  d date not null,
  cash_cents bigint not null,
  positions_value_cents bigint not null,
  equity_cents bigint not null,
  unique (portfolio_id, d)
);

-- ── sim_config (per-portfolio fill knobs) ────────────────────────────────────
create table sim_config (
  portfolio_id uuid primary key references portfolios(id) on delete cascade,
  slippage_bps int not null default 5,
  commission_cents bigint not null default 0
);

-- ── audit_log (Phase 2; wired now) ───────────────────────────────────────────
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references profiles(id),
  org_id uuid references orgs(id),
  entity text not null,
  entity_id uuid,
  action text not null,
  diff jsonb,
  created_at timestamptz not null default now()
);
