-- Row Level Security.
--
-- Phase 1: every row is scoped to the authenticated owner via portfolio
-- ownership. Phase 2 layers org-scoped advisor/client access ADDITIVELY on top
-- of these helpers — no rewrite, just extra policies.

-- Helper: does the current user own this portfolio? (Phase 2 will extend this
-- to also allow advisors within the same org.)
create or replace function owns_portfolio(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from portfolios p
    where p.id = pid and p.owner_id = auth.uid()
  );
$$;

alter table profiles      enable row level security;
alter table portfolios    enable row level security;
alter table cash_ledger   enable row level security;
alter table orders        enable row level security;
alter table trades        enable row level security;
alter table lots          enable row level security;
alter table positions     enable row level security;
alter table theses        enable row level security;
alter table watchlists    enable row level security;
alter table snapshots     enable row level security;
alter table sim_config    enable row level security;
-- instruments, price_cache, daily_bars are shared reference data: readable by
-- all authenticated users, writable only by service role (crons).
alter table instruments   enable row level security;
alter table price_cache   enable row level security;
alter table daily_bars    enable row level security;

-- profiles: a user sees/edits only their own profile row.
create policy profiles_self on profiles
  using (id = auth.uid()) with check (id = auth.uid());

-- portfolios: owner-scoped.
create policy portfolios_owner on portfolios
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Child tables: gated through portfolio ownership.
create policy cash_ledger_owner on cash_ledger
  using (owns_portfolio(portfolio_id)) with check (owns_portfolio(portfolio_id));
create policy orders_owner on orders
  using (owns_portfolio(portfolio_id)) with check (owns_portfolio(portfolio_id));
create policy trades_owner on trades
  using (owns_portfolio(portfolio_id)) with check (owns_portfolio(portfolio_id));
create policy lots_owner on lots
  using (owns_portfolio(portfolio_id)) with check (owns_portfolio(portfolio_id));
create policy positions_owner on positions
  using (owns_portfolio(portfolio_id)) with check (owns_portfolio(portfolio_id));
create policy theses_owner on theses
  using (owns_portfolio(portfolio_id)) with check (owns_portfolio(portfolio_id));
create policy snapshots_owner on snapshots
  using (owns_portfolio(portfolio_id)) with check (owns_portfolio(portfolio_id));
create policy sim_config_owner on sim_config
  using (owns_portfolio(portfolio_id)) with check (owns_portfolio(portfolio_id));

-- watchlists: owner-scoped directly.
create policy watchlists_owner on watchlists
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Reference data: readable by any authenticated user; no client writes
-- (service-role bypasses RLS for cron writes).
create policy instruments_read on instruments for select using (auth.role() = 'authenticated');
create policy price_cache_read on price_cache for select using (auth.role() = 'authenticated');
create policy daily_bars_read on daily_bars for select using (auth.role() = 'authenticated');
