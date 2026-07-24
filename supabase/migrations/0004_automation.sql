-- M7 — Rules-Based Trade Automation.
-- Rules are data (jsonb params) evaluated by a scheduled worker. History is
-- append-only; a rule is never mutated on trigger. Idempotency is enforced by a
-- UNIQUE constraint on (rule_id, trigger_bar_ts, decision).

create type rule_type as enum (
  'bracket_oco','stop_loss','take_profit','conditional_entry','scheduled','time_stop'
);
create type rule_status as enum (
  'draft','armed','triggered','completed','expired','cancelled','error'
);
create type rule_mode as enum ('simulate','live');

create table rules (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  instrument_id uuid references instruments(id),        -- null = portfolio-wide (EOD flatten)
  type rule_type not null,
  mode rule_mode not null default 'simulate',           -- dry-run first, always
  params jsonb not null,
  status rule_status not null default 'draft',
  parent_rule_id uuid references rules(id) on delete cascade,
  oco_group_id uuid,                                    -- both bracket legs share this
  hwm_cents bigint,                                     -- trailing high-water mark
  entry_price_cents bigint,
  entry_trade_id uuid references trades(id),
  valid_from timestamptz,
  valid_until timestamptz,
  version int not null default 1,
  supersedes_rule_id uuid references rules(id),
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);
create index on rules (portfolio_id, status);
create index on rules (instrument_id, status);
create index on rules (oco_group_id);

create table rule_events (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references rules(id) on delete cascade,
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  evaluated_at timestamptz not null default now(),
  trigger_bar_ts timestamptz not null,
  market_price_cents bigint,
  price_is_stale boolean not null default false,
  decision text not null check (decision in ('no_trigger','triggered','blocked')),
  reason_text text not null,
  resulting_order_id uuid references orders(id),
  gap_slippage_cents bigint,
  -- IDEMPOTENCY: at most one event per (rule, bar, decision). A duplicate cron
  -- tick re-inserting the same triggered event violates this and no-ops.
  unique (rule_id, trigger_bar_ts, decision)
);
create index on rule_events (rule_id, evaluated_at desc);
create index on rule_events (portfolio_id, evaluated_at desc);

create table automation_settings (
  portfolio_id uuid primary key references portfolios(id) on delete cascade,
  automation_enabled boolean not null default false,   -- global kill switch
  killed_at timestamptz,
  killed_by uuid references profiles(id),
  max_daily_loss_cents bigint,
  max_open_positions int,
  max_position_pct numeric(5,2),
  max_automated_orders_per_day int,
  daily_loss_breached_on date,
  partial_fill_enabled boolean not null default false,
  partial_fill_adv_pct numeric(5,2) default 5.0,
  updated_at timestamptz not null default now()
);

-- Provenance on orders/trades (nullable = manual).
alter table orders add column rule_id uuid references rules(id);
alter table orders add column automated boolean not null default false;
alter table trades add column rule_id uuid references rules(id);
alter table trades add column gap_slippage_cents bigint;

-- RLS — same owner gate as Phase 1/2.
alter table rules enable row level security;
alter table rule_events enable row level security;
alter table automation_settings enable row level security;

create policy rules_owner on rules
  using (owns_portfolio(portfolio_id)) with check (owns_portfolio(portfolio_id));
create policy rule_events_owner on rule_events
  using (owns_portfolio(portfolio_id)) with check (owns_portfolio(portfolio_id));
create policy automation_settings_owner on automation_settings
  using (owns_portfolio(portfolio_id)) with check (owns_portfolio(portfolio_id));

-- Transactional trigger→order→ledger fill for automated rules. Called by the
-- Edge worker via rpc so the whole thing is ONE transaction; a mid-way failure
-- rolls back and the UNIQUE(rule_event) guard makes a retry safe.
create or replace function fire_rule(
  p_rule_id uuid,
  p_portfolio_id uuid,
  p_instrument_id uuid,
  p_side text,
  p_qty numeric,
  p_fill_price_cents bigint,
  p_commission_cents bigint,
  p_gap_slippage_cents bigint,
  p_trigger_bar_ts timestamptz,
  p_reason text
) returns uuid
language plpgsql
security definer set search_path = public as $$
declare
  v_event_id uuid;
  v_order_id uuid;
  v_trade_id uuid;
  v_notional bigint := round(p_qty * p_fill_price_cents);
begin
  -- Idempotency guard: insert the triggered event first. If this (rule, bar)
  -- already fired, the UNIQUE constraint raises and we abort without side effects.
  insert into rule_events (rule_id, portfolio_id, trigger_bar_ts, market_price_cents,
                           decision, reason_text, gap_slippage_cents)
  values (p_rule_id, p_portfolio_id, p_trigger_bar_ts, p_fill_price_cents,
          'triggered', p_reason, p_gap_slippage_cents)
  returning id into v_event_id;

  insert into orders (portfolio_id, instrument_id, side, type, qty, status,
                      filled_qty, rule_id, automated)
  values (p_portfolio_id, p_instrument_id, p_side, 'market', p_qty, 'filled',
          p_qty, p_rule_id, true)
  returning id into v_order_id;

  insert into trades (order_id, portfolio_id, instrument_id, side, qty,
                      price_cents, commission_cents, rule_id, gap_slippage_cents)
  values (v_order_id, p_portfolio_id, p_instrument_id, p_side, p_qty,
          p_fill_price_cents, p_commission_cents, p_rule_id, p_gap_slippage_cents)
  returning id into v_trade_id;

  insert into cash_ledger (portfolio_id, amount_cents, reason, ref_trade_id)
  values (p_portfolio_id,
          case when p_side = 'buy' then -v_notional else v_notional end,
          p_side, v_trade_id);
  if p_commission_cents > 0 then
    insert into cash_ledger (portfolio_id, amount_cents, reason, ref_trade_id)
    values (p_portfolio_id, -p_commission_cents, 'commission', v_trade_id);
  end if;

  update rule_events set resulting_order_id = v_order_id where id = v_event_id;
  update rules set status = 'completed', entry_trade_id = coalesce(entry_trade_id, v_trade_id)
    where id = p_rule_id;

  -- NOTE: FIFO lot/position rebuild is performed by the worker after this rpc
  -- (reads trades, recomputes lots) — documented; keeps the tx focused on the
  -- money-critical, must-be-atomic writes.
  return v_order_id;
end;
$$;
