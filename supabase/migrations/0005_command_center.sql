-- M8 — Command Center (Master Portfolio & Market Dashboard).
-- Thin, additive tables only. No change to money paths, ledger, or fill engine.
-- Reference-data caches (fundamentals/news/earnings) are keyed by instrument and
-- written ONLY by service-role crons; owner-scoped tables reuse the Phase-1 gate.

-- ── fundamentals_cache — sole writer = refresh-fundamentals cron (daily) ──────
create table fundamentals_cache (
  instrument_id    uuid primary key references instruments(id) on delete cascade,
  sector           text,
  market_cap_cents bigint,
  pe               numeric,
  eps_cents        bigint,
  beta             numeric,
  dividend_yield   numeric,
  high_52w_cents   bigint,
  low_52w_cents    bigint,
  net_margin       numeric,
  gross_margin     numeric,
  raw              jsonb,            -- full vendor payload → every figure traceable
  fetched_at       timestamptz not null default now(),
  source           text not null default 'finnhub',
  is_partial       boolean not null default true   -- free tier: fields may be null
);

-- ── news_cache — writer = refresh-news cron; deduped on (instrument, url) ─────
create table news_cache (
  id            uuid primary key default gen_random_uuid(),
  instrument_id uuid not null references instruments(id) on delete cascade,
  headline      text not null,
  url           text,
  source        text,
  published_at  timestamptz not null,
  fetched_at    timestamptz not null default now(),
  unique (instrument_id, url)
);
create index on news_cache (instrument_id, published_at desc);

-- ── earnings_cache — next known earnings date (nullable when tier hides it) ───
create table earnings_cache (
  instrument_id      uuid primary key references instruments(id) on delete cascade,
  next_earnings_date date,
  fetched_at         timestamptz not null default now(),
  available          boolean not null default false  -- false = tier didn't provide it
);

-- ── watchlist_theses — pre-recorded thesis/trigger for names watched not held ─
create table watchlist_theses (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null references profiles(id) on delete cascade,
  instrument_id       uuid not null references instruments(id) on delete cascade,
  trigger_price_cents bigint,
  direction           text check (direction in ('above','below')),
  thesis              text,
  conviction          int check (conviction between 1 and 5),
  tags                text[] default '{}',
  created_at          timestamptz not null default now(),
  unique (owner_id, instrument_id)
);
create index on watchlist_theses (owner_id);

-- ── dashboard_prefs — per-user cockpit prefs (one row per user) ──────────────
create table dashboard_prefs (
  owner_id          uuid primary key references profiles(id) on delete cascade,
  default_range     text not null default '1M',
  refresh_seconds   int not null default 60,
  concentration_pct numeric not null default 20.0,
  updated_at        timestamptz not null default now()
);

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Reference caches: readable by any authenticated user, writable only by the
-- service role (crons bypass RLS with the service key; no client write policy).
alter table fundamentals_cache enable row level security;
alter table news_cache        enable row level security;
alter table earnings_cache    enable row level security;
create policy fundamentals_read on fundamentals_cache for select using (auth.role() = 'authenticated');
create policy news_read         on news_cache        for select using (auth.role() = 'authenticated');
create policy earnings_read     on earnings_cache    for select using (auth.role() = 'authenticated');

-- Owner-scoped: same self gate as watchlists.
alter table watchlist_theses enable row level security;
alter table dashboard_prefs  enable row level security;
create policy watchlist_theses_owner on watchlist_theses
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy dashboard_prefs_owner on dashboard_prefs
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
