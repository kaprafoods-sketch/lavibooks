"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { simulateFill } from "@/lib/engine/orders";
import { weightedAvgCostCents } from "@/lib/engine/lots";
import { shouldQueueForOpen } from "@/lib/calendar/nyse";
import type { Lot, OrderIntent, SimConfig } from "@/lib/types";
import { toCents } from "@/lib/money";

export interface OrderFormResult {
  ok: boolean;
  message: string;
}

/**
 * Submit an order. Validates ownership via RLS, runs the pure fill engine, and
 * atomically-ish persists order + trade + ledger rows + lots + position +
 * optional thesis + audit row. (Real production would wrap this in an RPC/tx;
 * documented as a v1 gap.)
 */
export async function submitOrder(
  _prev: OrderFormResult | null,
  formData: FormData,
): Promise<OrderFormResult> {
  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };

  const portfolioId = String(formData.get("portfolio_id"));
  const symbol = String(formData.get("symbol")).toUpperCase().trim();
  const side = String(formData.get("side")) as "buy" | "sell";
  const type = String(formData.get("type")) as OrderIntent["type"];
  const qty = Number(formData.get("qty"));
  const limitDollars = formData.get("limit_price");
  const stopDollars = formData.get("stop_price");

  if (!symbol || !(qty > 0)) return { ok: false, message: "Symbol and positive quantity required." };

  // Resolve instrument.
  const { data: instrument } = await sb
    .from("instruments").select("id").eq("symbol", symbol).maybeSingle();
  if (!instrument) return { ok: false, message: `Unknown symbol ${symbol}. Add it from Trade search first.` };

  // Load config, ledger, lots, last price (from cache — never a vendor call).
  const [{ data: cfgRow }, { data: ledger }, { data: lotRows }, { data: price }] = await Promise.all([
    sb.from("sim_config").select("*").eq("portfolio_id", portfolioId).maybeSingle(),
    sb.from("cash_ledger").select("amount_cents,reason").eq("portfolio_id", portfolioId),
    sb.from("lots").select("*").eq("portfolio_id", portfolioId).eq("instrument_id", instrument.id).gt("qty_open", 0),
    sb.from("price_cache").select("last_price_cents").eq("instrument_id", instrument.id).maybeSingle(),
  ]);

  if (!price) return { ok: false, message: `No cached price for ${symbol} yet. Try again after the next quote refresh.` };

  const config: SimConfig = {
    slippageBps: cfgRow?.slippage_bps ?? Number(process.env.SIM_SLIPPAGE_BPS ?? 5),
    commissionCents: cfgRow?.commission_cents ?? Number(process.env.SIM_COMMISSION_CENTS ?? 0),
  };
  const intent: OrderIntent = {
    side, type, qty,
    limitPriceCents: limitDollars ? toCents(Number(limitDollars)) : undefined,
    stopPriceCents: stopDollars ? toCents(Number(stopDollars)) : undefined,
  };
  const lots: Lot[] = (lotRows ?? []).map((r) => ({
    id: r.id, qtyOpen: Number(r.qty_open), qtyOriginal: Number(r.qty_original),
    costCents: r.cost_cents, openedAt: r.opened_at,
  }));

  const now = new Date();
  const queued = type !== "market" || shouldQueueForOpen(now);

  // Insert the order first (pending) so we always have a record.
  const { data: order, error: orderErr } = await sb.from("orders").insert({
    portfolio_id: portfolioId, instrument_id: instrument.id, side, type, qty,
    limit_price_cents: intent.limitPriceCents ?? null,
    stop_price_cents: intent.stopPriceCents ?? null,
    queued_for_open: shouldQueueForOpen(now) && type === "market",
    status: "pending",
  }).select("id").single();
  if (orderErr || !order) return { ok: false, message: `Could not record order: ${orderErr?.message}` };

  // Optional thesis capture.
  const thesisText = formData.get("thesis_text");
  if (thesisText || formData.get("target_price") || formData.get("conviction")) {
    await sb.from("theses").insert({
      order_id: order.id, portfolio_id: portfolioId,
      text: thesisText ? String(thesisText) : null,
      target_price_cents: formData.get("target_price") ? toCents(Number(formData.get("target_price"))) : null,
      horizon_days: formData.get("horizon_days") ? Number(formData.get("horizon_days")) : null,
      conviction: formData.get("conviction") ? Number(formData.get("conviction")) : null,
      tags: formData.get("tags") ? String(formData.get("tags")).split(",").map((s) => s.trim()).filter(Boolean) : [],
    });
  }

  // Limit/stop or after-hours market → leave pending for the match-orders cron.
  if (queued && type !== "market") {
    return { ok: true, message: `${type.toUpperCase()} order queued — will fill when the trigger is met.` };
  }
  if (queued && type === "market") {
    return { ok: true, message: "Market closed — order queued for next open." };
  }

  // Execute the fill against the pure engine.
  const outcome = simulateFill({
    intent, lastPriceCents: price.last_price_cents,
    ledger: (ledger ?? []).map((r) => ({ amountCents: r.amount_cents, reason: r.reason })),
    lots, config, now: now.toISOString(),
    newLotId: crypto.randomUUID(),
  });

  if (outcome.status === "rejected") {
    await sb.from("orders").update({ status: "rejected", reject_reason: outcome.rejectReason }).eq("id", order.id);
    return { ok: false, message: outcome.rejectReason ?? "Order rejected." };
  }

  // Persist the trade.
  const { data: trade } = await sb.from("trades").insert({
    order_id: order.id, portfolio_id: portfolioId, instrument_id: instrument.id,
    side, qty: outcome.fill!.qty, price_cents: outcome.fill!.priceCents,
    commission_cents: outcome.fill!.commissionCents,
  }).select("id").single();

  // Ledger rows.
  for (const row of outcome.ledgerRows) {
    await sb.from("cash_ledger").insert({
      portfolio_id: portfolioId, amount_cents: row.amountCents, reason: row.reason,
      ref_trade_id: trade?.id ?? null,
    });
  }

  // Lots: replace this instrument's lots with the engine's result set.
  await sb.from("lots").delete().eq("portfolio_id", portfolioId).eq("instrument_id", instrument.id);
  if (outcome.lots.length) {
    await sb.from("lots").insert(outcome.lots.map((l) => ({
      id: l.id, portfolio_id: portfolioId, instrument_id: instrument.id,
      open_trade_id: trade?.id, qty_open: l.qtyOpen, qty_original: l.qtyOriginal,
      cost_cents: l.costCents, opened_at: l.openedAt,
    })));
  }

  // Rebuild denormalized position.
  const qtyOpen = outcome.lots.reduce((a, l) => a + l.qtyOpen, 0);
  if (qtyOpen > 0) {
    await sb.from("positions").upsert({
      portfolio_id: portfolioId, instrument_id: instrument.id,
      qty: qtyOpen, avg_cost_cents: weightedAvgCostCents(outcome.lots),
    });
  } else {
    await sb.from("positions").delete().eq("portfolio_id", portfolioId).eq("instrument_id", instrument.id);
  }

  await sb.from("orders").update({ status: "filled", filled_qty: outcome.fill!.qty }).eq("id", order.id);
  await sb.from("audit_log").insert({
    actor_id: user.id, entity: "order", entity_id: order.id, action: "fill",
    diff: { side, symbol, qty, price_cents: outcome.fill!.priceCents },
  });

  revalidatePath("/");
  revalidatePath("/orders");
  return {
    ok: true,
    message: `${side === "buy" ? "Bought" : "Sold"} ${qty} ${symbol} @ ~$${(outcome.fill!.priceCents / 100).toFixed(2)}.`,
  };
}
