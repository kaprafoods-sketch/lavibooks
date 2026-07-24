/**
 * Seed script — the app is never empty on first run.
 * Creates: a demo user, one manual portfolio with $100,000 virtual cash,
 * ~20 sample trades (with theses), instruments, cached prices, ~180 days of
 * synthetic daily bars for backtests, and EOD snapshots for the equity curve.
 *
 * Uses the SERVICE ROLE key (bypasses RLS). Run: pnpm seed
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.
 */
import { createClient } from "@supabase/supabase-js";
import { simulateFill } from "../lib/engine/orders";
import { weightedAvgCostCents } from "../lib/engine/lots";
import type { Lot, SimConfig } from "../lib/types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your env.");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

const DEMO_EMAIL = "demo@lavibooks.test";
const DEMO_PASSWORD = "lavibooks-demo-123";

const UNIVERSE = [
  { symbol: "AAPL", name: "Apple Inc.", exchange: "NASDAQ", price: 21550 },
  { symbol: "MSFT", name: "Microsoft Corp.", exchange: "NASDAQ", price: 42010 },
  { symbol: "NVDA", name: "NVIDIA Corp.", exchange: "NASDAQ", price: 12630 },
  { symbol: "AMZN", name: "Amazon.com Inc.", exchange: "NASDAQ", price: 18740 },
  { symbol: "GOOGL", name: "Alphabet Inc.", exchange: "NASDAQ", price: 17820 },
  { symbol: "TSLA", name: "Tesla Inc.", exchange: "NASDAQ", price: 24500 },
  { symbol: "JPM", name: "JPMorgan Chase", exchange: "NYSE", price: 20130 },
  { symbol: "V", name: "Visa Inc.", exchange: "NYSE", price: 28040 },
];

const config: SimConfig = { slippageBps: 5, commissionCents: 0 };

// Deterministic pseudo-random so seeds are reproducible.
let s = 12345;
const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

async function main() {
  console.log("Seeding Lavi Books…");

  // 1) Demo user (idempotent).
  let userId: string;
  const { data: created, error: cErr } = await sb.auth.admin.createUser({
    email: DEMO_EMAIL, password: DEMO_PASSWORD, email_confirm: true,
  });
  if (cErr && !cErr.message.includes("already")) throw cErr;
  if (created?.user) {
    userId = created.user.id;
  } else {
    const { data: list } = await sb.auth.admin.listUsers();
    userId = list.users.find((u) => u.email === DEMO_EMAIL)!.id;
  }
  await sb.from("profiles").upsert({ id: userId, display_name: "Demo Trader", role: "client" });

  // 2) Fresh manual portfolio.
  await sb.from("portfolios").delete().eq("owner_id", userId).eq("kind", "manual");
  const { data: pf } = await sb.from("portfolios")
    .insert({ owner_id: userId, name: "Main (paper)", kind: "manual" }).select("id").single();
  const portfolioId = pf!.id;
  await sb.from("sim_config").upsert({ portfolio_id: portfolioId, slippage_bps: 5, commission_cents: 0 });

  // 3) $100,000 virtual cash.
  await sb.from("cash_ledger").insert({ portfolio_id: portfolioId, amount_cents: 10_000_000, reason: "deposit" });

  // 4) Instruments + cached prices + daily bars.
  const instrumentIds: Record<string, string> = {};
  for (const u of UNIVERSE) {
    const { data: inst } = await sb.from("instruments")
      .upsert({ symbol: u.symbol, name: u.name, exchange: u.exchange }, { onConflict: "symbol" })
      .select("id").single();
    instrumentIds[u.symbol] = inst!.id;
    await sb.from("price_cache").upsert({
      instrument_id: inst!.id, last_price_cents: u.price, prev_close_cents: Math.round(u.price * 0.99),
      is_delayed: true, source: "seed",
    });
    // ~180 synthetic daily bars (random walk around the current price).
    const bars: { instrument_id: string; d: string; open_cents: number; high_cents: number; low_cents: number; close_cents: number; volume: number }[] = [];
    let px = u.price * 0.7;
    const start = new Date(); start.setDate(start.getDate() - 180);
    for (let i = 0; i < 180; i++) {
      const day = new Date(start); day.setDate(start.getDate() + i);
      if (day.getDay() === 0 || day.getDay() === 6) continue;
      const drift = 1 + (rand() - 0.48) * 0.03;
      const close = Math.max(100, Math.round(px * drift));
      const open = Math.round((px + close) / 2);
      bars.push({
        instrument_id: inst!.id, d: day.toISOString().slice(0, 10),
        open_cents: open, high_cents: Math.max(open, close) + 20,
        low_cents: Math.min(open, close) - 20, close_cents: close,
        volume: 1_000_000 + Math.floor(rand() * 500_000),
      });
      px = close;
    }
    await sb.from("daily_bars").delete().eq("instrument_id", inst!.id);
    await sb.from("daily_bars").insert(bars);
  }

  // 5) ~20 sample trades with theses, run through the real engine.
  const theses = ["Earnings momentum", "Oversold bounce", "AI tailwind", "Sector rotation", "Breakout retest"];
  const tags = [["tech", "momentum"], ["value"], ["ai", "growth"], ["financials"], ["breakout"]];
  const lotsBySymbol: Record<string, Lot[]> = {};
  const ledger: { amountCents: number; reason: "deposit" | "buy" | "sell" | "commission" | "adjustment" }[] =
    [{ amountCents: 10_000_000, reason: "deposit" }];

  for (let i = 0; i < 20; i++) {
    const u = UNIVERSE[i % UNIVERSE.length];
    const isSell = i >= 14 && (lotsBySymbol[u.symbol]?.reduce((a, l) => a + l.qtyOpen, 0) ?? 0) > 0;
    const side = isSell ? "sell" : "buy";
    const qty = 5 + Math.floor(rand() * 15);
    const lastPrice = Math.round(u.price * (0.85 + rand() * 0.25));

    const outcome = simulateFill({
      intent: { side, type: "market", qty },
      lastPriceCents: lastPrice,
      ledger, lots: lotsBySymbol[u.symbol] ?? [],
      config, now: new Date(Date.now() - (20 - i) * 86400000).toISOString(),
      newLotId: crypto.randomUUID(),
    });
    if (outcome.status !== "filled") continue;

    const { data: order } = await sb.from("orders").insert({
      portfolio_id: portfolioId, instrument_id: instrumentIds[u.symbol], side, type: "market",
      qty, status: "filled", filled_qty: qty,
      created_at: new Date(Date.now() - (20 - i) * 86400000).toISOString(),
    }).select("id").single();

    const { data: trade } = await sb.from("trades").insert({
      order_id: order!.id, portfolio_id: portfolioId, instrument_id: instrumentIds[u.symbol],
      side, qty, price_cents: outcome.fill!.priceCents, commission_cents: 0,
      filled_at: new Date(Date.now() - (20 - i) * 86400000).toISOString(),
    }).select("id").single();

    for (const row of outcome.ledgerRows) {
      await sb.from("cash_ledger").insert({ portfolio_id: portfolioId, amount_cents: row.amountCents, reason: row.reason, ref_trade_id: trade!.id });
      ledger.push({ amountCents: row.amountCents, reason: row.reason });
    }

    if (side === "buy") {
      await sb.from("theses").insert({
        order_id: order!.id, portfolio_id: portfolioId,
        text: theses[i % theses.length],
        target_price_cents: Math.round(outcome.fill!.priceCents * 1.15),
        horizon_days: 30, conviction: 1 + (i % 5), tags: tags[i % tags.length],
      });
    }
    lotsBySymbol[u.symbol] = outcome.lots;
  }

  // Persist final lots + positions per symbol.
  for (const [symbol, lots] of Object.entries(lotsBySymbol)) {
    const iid = instrumentIds[symbol];
    await sb.from("lots").delete().eq("portfolio_id", portfolioId).eq("instrument_id", iid);
    if (lots.length) {
      const { data: anyTrade } = await sb.from("trades").select("id").eq("portfolio_id", portfolioId).eq("instrument_id", iid).limit(1).single();
      await sb.from("lots").insert(lots.map((l) => ({
        id: l.id, portfolio_id: portfolioId, instrument_id: iid, open_trade_id: anyTrade!.id,
        qty_open: l.qtyOpen, qty_original: l.qtyOriginal, cost_cents: l.costCents, opened_at: l.openedAt,
      })));
      await sb.from("positions").upsert({ portfolio_id: portfolioId, instrument_id: iid, qty: lots.reduce((a, l) => a + l.qtyOpen, 0), avg_cost_cents: weightedAvgCostCents(lots) });
    }
  }

  // 6) EOD snapshots (equity curve) — simple synthetic path from cash + holdings.
  const balance = ledger.reduce((a, r) => a + r.amountCents, 0);
  await sb.from("snapshots").delete().eq("portfolio_id", portfolioId);
  const snaps = [];
  for (let d = 30; d >= 0; d--) {
    const day = new Date(); day.setDate(day.getDate() - d);
    const noise = 1 + (rand() - 0.5) * 0.02;
    const equity = Math.round((balance + 2_000_000) * (0.97 + (30 - d) * 0.001) * noise);
    snaps.push({ portfolio_id: portfolioId, d: day.toISOString().slice(0, 10), cash_cents: balance, positions_value_cents: equity - balance, equity_cents: equity });
  }
  await sb.from("snapshots").insert(snaps);

  // 7) Automation: settings + a couple of sample rules (simulate mode) so the
  //    Rules page is never empty on first run.
  await sb.from("automation_settings").upsert({
    portfolio_id: portfolioId, automation_enabled: true,
    max_daily_loss_cents: 500_000, max_open_positions: 10,
    max_position_pct: 25, max_automated_orders_per_day: 20,
  });
  const heldSymbol = Object.keys(lotsBySymbol).find((s) => (lotsBySymbol[s]?.reduce((a, l) => a + l.qtyOpen, 0) ?? 0) > 0);
  if (heldSymbol) {
    const iid = instrumentIds[heldSymbol];
    const qty = lotsBySymbol[heldSymbol].reduce((a, l) => a + l.qtyOpen, 0);
    const entry = lotsBySymbol[heldSymbol][0].costCents;
    await sb.from("rules").insert([
      {
        portfolio_id: portfolioId, instrument_id: iid, type: "stop_loss", mode: "simulate",
        status: "armed", entry_price_cents: entry, hwm_cents: entry, valid_from: new Date().toISOString(),
        params: { qty, trigger: { mode: "pct_below_entry", pct: 5 } },
      },
      {
        portfolio_id: portfolioId, instrument_id: iid, type: "take_profit", mode: "simulate",
        status: "armed", entry_price_cents: entry, valid_from: new Date().toISOString(),
        params: { qty, trigger: { mode: "pct_gain", pct: 15 } },
      },
    ]);
  }

  console.log(`✓ Seeded. Login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log("  (Or use the magic-link login with this email in local Supabase.)");
}

main().catch((e) => { console.error(e); process.exit(1); });
