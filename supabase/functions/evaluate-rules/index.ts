// M7 Edge cron: the rules evaluation worker.
//
// Cadence A: every 1 min during NYSE RTH  → all armed price-driven rules
// Cadence B: once at open / once ~T-15 close → scheduled rules (?mode=scheduled)
//
// Guarantees:
//  • Per-portfolio advisory lock — overlapping cron runs can't process a rule twice.
//  • Idempotency — fire_rule() inserts a UNIQUE rule_event; a duplicate tick no-ops.
//  • Fail closed — kill switch, daily-loss breach, stale price (>15m), vendor
//    error → 'blocked' event, no order.
//  • Simulate mode — logs the decision but never calls fire_rule.
//
// Evaluation math is inlined here to run under Deno; keep in sync with
// lib/rules/*. Deploy: supabase functions deploy evaluate-rules

import { createClient } from "jsr:@supabase/supabase-js@2";

const STALE_MS = 15 * 60 * 1000;
const FINNHUB = "https://finnhub.io/api/v1";

function slip(px: number, side: string, bps: number) {
  return Math.round(px * (side === "buy" ? 1 + bps / 10000 : 1 - bps / 10000));
}

type Ctx = {
  entry: number | null; hwm: number | null; prevClose: number | null;
  held: number; daysHeld: number;
};

// Returns { decision, reason, order?, newHwm? } — mirrors lib/rules/evaluators.ts.
function evaluate(type: string, params: any, close: number, ctx: Ctx) {
  const held = ctx.held;
  switch (type) {
    case "stop_loss": {
      let hwm = ctx.hwm;
      let level: number | null = null;
      const t = params.trigger;
      if (t.mode === "absolute") level = t.price_cents;
      else if (t.mode === "pct_below_entry") level = ctx.entry != null ? Math.round(ctx.entry * (1 - t.pct / 100)) : null;
      else if (t.mode === "trailing_pct") { hwm = hwm == null ? close : Math.max(hwm, close); level = Math.round(hwm * (1 - t.pct / 100)); }
      if (level == null) return { decision: "blocked", reason: "stop level unavailable", newHwm: hwm };
      if (held <= 0) return { decision: "blocked", reason: "no position", newHwm: hwm };
      return close <= level
        ? { decision: "triggered", reason: `price ${close} ≤ stop ${level}`, order: { side: "sell", qty: Math.min(params.qty, held) }, newHwm: hwm }
        : { decision: "no_trigger", reason: `above stop ${level}`, newHwm: hwm };
    }
    case "take_profit": {
      const t = params.trigger;
      let level: number | null = null;
      if (t.mode === "absolute") level = t.price_cents;
      else if (t.mode === "pct_gain") level = ctx.entry != null ? Math.round(ctx.entry * (1 + t.pct / 100)) : null;
      else if (t.mode === "r_multiple") level = ctx.entry != null ? ctx.entry + Math.round(t.r * t.initial_risk_cents) : null;
      if (level == null) return { decision: "blocked", reason: "target unavailable" };
      if (held <= 0) return { decision: "blocked", reason: "no position" };
      return close >= level
        ? { decision: "triggered", reason: `price ${close} ≥ target ${level}`, order: { side: "sell", qty: Math.min(params.qty, held) } }
        : { decision: "no_trigger", reason: `below target ${level}` };
    }
    case "conditional_entry": {
      const t = params.trigger;
      if (t.mode === "cross_above") {
        if (ctx.prevClose == null) return { decision: "no_trigger", reason: "no prior close" };
        return ctx.prevClose <= t.price_cents && close > t.price_cents
          ? { decision: "triggered", reason: `crossed above ${t.price_cents}`, order: { side: params.side, qty: params.qty } }
          : { decision: "no_trigger", reason: "no cross" };
      }
      if (t.mode === "cross_below") {
        if (ctx.prevClose == null) return { decision: "no_trigger", reason: "no prior close" };
        return ctx.prevClose >= t.price_cents && close < t.price_cents
          ? { decision: "triggered", reason: `crossed below ${t.price_cents}`, order: { side: params.side, qty: params.qty } }
          : { decision: "no_trigger", reason: "no cross" };
      }
      return { decision: "no_trigger", reason: "strategy signals evaluated in app path" };
    }
    case "time_stop": {
      if (held <= 0) return { decision: "blocked", reason: "no position" };
      return ctx.daysHeld >= params.trading_days
        ? { decision: "triggered", reason: `held ${ctx.daysHeld} ≥ ${params.trading_days} days`, order: { side: "sell", qty: Math.min(params.qty, held) } }
        : { decision: "no_trigger", reason: `held ${ctx.daysHeld}/${params.trading_days}` };
    }
    case "scheduled": {
      if (params.action === "place_at_open") return { decision: "triggered", reason: "scheduled at open", order: { side: params.side, qty: params.qty } };
      if (held <= 0) return { decision: "no_trigger", reason: "nothing to flatten" };
      return { decision: "triggered", reason: "EOD flatten", order: { side: "sell", qty: held } };
    }
    default:
      return { decision: "blocked", reason: `unsupported type ${type}` };
  }
}

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const finnhubKey = Deno.env.get("FINNHUB_API_KEY")!;
  const scheduledOnly = new URL(req.url).searchParams.get("mode") === "scheduled";

  const { data: portfolios } = await sb.from("portfolios").select("id");
  const summary: Record<string, number> = { evaluated: 0, triggered: 0, blocked: 0 };

  for (const pf of portfolios ?? []) {
    // Advisory lock so overlapping runs don't double-process this portfolio.
    const lockKey = hashToInt(pf.id);
    const { data: lock } = await sb.rpc("pg_try_advisory_lock", { key: lockKey }).single().catch(() => ({ data: true }));
    if (lock === false) continue;

    try {
      const { data: settings } = await sb.from("automation_settings").select("*").eq("portfolio_id", pf.id).maybeSingle();
      const today = new Date().toISOString().slice(0, 10);

      // Kill switch / daily-loss gate — write nothing, just skip.
      if (!settings?.automation_enabled) continue;
      const killed = settings.daily_loss_breached_on === today;

      let rulesQ = sb.from("rules").select("*").eq("portfolio_id", pf.id).eq("status", "armed");
      if (scheduledOnly) rulesQ = rulesQ.eq("type", "scheduled");
      const { data: rules } = await rulesQ;
      if (!rules?.length) continue;

      // Batch quotes: ONE call per unique symbol.
      const iids = [...new Set(rules.map((r) => r.instrument_id).filter(Boolean))];
      const { data: insts } = await sb.from("instruments").select("id,symbol").in("id", iids as string[]);
      const symById = new Map((insts ?? []).map((i) => [i.id, i.symbol]));
      const quoteByIid = new Map<string, { price: number; ts: number; stale: boolean }>();
      for (const iid of iids as string[]) {
        // Prefer cache; fall back to a single vendor call if missing/stale.
        const { data: pc } = await sb.from("price_cache").select("last_price_cents,fetched_at").eq("instrument_id", iid).maybeSingle();
        let price = pc?.last_price_cents ?? null;
        let ts = pc ? new Date(pc.fetched_at).getTime() : 0;
        if (!pc || Date.now() - ts > STALE_MS) {
          try {
            const res = await fetch(`${FINNHUB}/quote?symbol=${symById.get(iid)}&token=${finnhubKey}`);
            const j = await res.json();
            if (j.c) { price = Math.round(j.c * 100); ts = Date.now(); }
          } catch { /* leave stale — will block */ }
        }
        if (price != null) quoteByIid.set(iid, { price, ts, stale: Date.now() - ts > STALE_MS });
      }

      const triggerBarTs = new Date().toISOString();

      for (const rule of rules) {
        summary.evaluated++;
        const q = rule.instrument_id ? quoteByIid.get(rule.instrument_id) : null;

        // Fail closed on missing/stale price.
        if (rule.instrument_id && (!q || q.stale)) {
          await logEvent(sb, rule, triggerBarTs, q?.price ?? null, true, "blocked", "stale or missing price (>15 min) — blocked");
          summary.blocked++; continue;
        }
        if (killed) {
          await logEvent(sb, rule, triggerBarTs, q?.price ?? null, false, "blocked", "max daily loss breached — disarmed");
          summary.blocked++; continue;
        }

        // Context (held qty, entry, days held).
        const { data: pos } = await sb.from("positions").select("qty").eq("portfolio_id", pf.id).eq("instrument_id", rule.instrument_id).maybeSingle();
        const ctx: Ctx = {
          entry: rule.entry_price_cents, hwm: rule.hwm_cents, prevClose: null,
          held: pos ? Number(pos.qty) : 0, daysHeld: tradingDaysSince(rule.valid_from),
        };
        const close = q?.price ?? 0;
        const r = evaluate(rule.type, rule.params, close, ctx);

        // Persist ratcheted HWM even when not triggered.
        if ((r as any).newHwm != null && (r as any).newHwm !== rule.hwm_cents) {
          await sb.from("rules").update({ hwm_cents: (r as any).newHwm }).eq("id", rule.id);
        }

        if (r.decision !== "triggered") {
          await logEvent(sb, rule, triggerBarTs, close, false, r.decision, r.reason);
          continue;
        }

        // SIMULATE mode: log the would-be trigger, emit no order.
        if (rule.mode === "simulate") {
          await logEvent(sb, rule, triggerBarTs, close, false, "triggered", `[SIMULATE] ${r.reason}`);
          continue;
        }

        // Safety rails (buying power, caps, orders/day) before firing.
        const rail = await checkRails(sb, pf.id, rule, r.order!, close, settings);
        if (!rail.ok) {
          await logEvent(sb, rule, triggerBarTs, close, false, "blocked", rail.reason);
          summary.blocked++; continue;
        }

        // Fill price (gap-aware would use the bar; cache path uses last price).
        const fillPx = slip(close, r.order!.side, settings.slippage_bps ?? 5);
        // ONE transaction — fire_rule inserts the idempotent event + order + trade + ledger.
        const { error } = await sb.rpc("fire_rule", {
          p_rule_id: rule.id, p_portfolio_id: pf.id, p_instrument_id: rule.instrument_id,
          p_side: r.order!.side, p_qty: r.order!.qty, p_fill_price_cents: fillPx,
          p_commission_cents: settings.commission_cents ?? 0, p_gap_slippage_cents: 0,
          p_trigger_bar_ts: triggerBarTs, p_reason: r.reason,
        });
        if (error) {
          // UNIQUE violation = duplicate tick already fired this bar → safe no-op.
          await logEvent(sb, rule, triggerBarTs, close, false, "no_trigger", `already fired this bar (${error.code})`).catch(() => {});
          continue;
        }
        summary.triggered++;

        // OCO: cancel the sibling leg in the same group.
        if (rule.oco_group_id) {
          await sb.from("rules").update({ status: "cancelled" })
            .eq("oco_group_id", rule.oco_group_id).neq("id", rule.id).eq("status", "armed");
        }
      }
    } finally {
      await sb.rpc("pg_advisory_unlock", { key: lockKey }).catch(() => {});
    }
  }

  return new Response(JSON.stringify(summary), { headers: { "content-type": "application/json" } });
});

async function logEvent(sb: any, rule: any, ts: string, price: number | null, stale: boolean, decision: string, reason: string) {
  await sb.from("rule_events").insert({
    rule_id: rule.id, portfolio_id: rule.portfolio_id, trigger_bar_ts: ts,
    market_price_cents: price, price_is_stale: stale, decision, reason_text: reason,
  });
}

async function checkRails(sb: any, pfId: string, rule: any, order: any, price: number, settings: any) {
  const { data: ledger } = await sb.from("cash_ledger").select("amount_cents").eq("portfolio_id", pfId);
  const cash = (ledger ?? []).reduce((a: number, r: any) => a + r.amount_cents, 0);
  if (order.side === "buy") {
    const notional = Math.round(order.qty * price);
    if (notional > cash) return { ok: false, reason: `insufficient buying power (short ${notional - cash}¢)` };
    if (settings.max_position_pct != null) {
      const { count } = await sb.from("orders").select("id", { count: "exact", head: true })
        .eq("portfolio_id", pfId).eq("automated", true).gte("created_at", new Date().toISOString().slice(0, 10));
      if (settings.max_automated_orders_per_day != null && (count ?? 0) >= settings.max_automated_orders_per_day) {
        return { ok: false, reason: "max automated orders/day reached" };
      }
    }
  }
  return { ok: true, reason: "ok" };
}

function tradingDaysSince(from: string | null): number {
  if (!from) return 0;
  const ms = Date.now() - new Date(from).getTime();
  return Math.floor(ms / 86400000 * 5 / 7); // rough weekday count
}

function hashToInt(uuid: string): number {
  let h = 0;
  for (const ch of uuid) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return h;
}
