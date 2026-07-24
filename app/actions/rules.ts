"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { toCents } from "@/lib/money";
import type { RuleParams, RuleType, StopTrigger, TakeTrigger } from "@/lib/rules/types";

export interface RuleActionResult { ok: boolean; message: string }

/** Create a rule (defaults to simulate mode — dry-run first, always). */
export async function createRule(_prev: RuleActionResult | null, formData: FormData): Promise<RuleActionResult> {
  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };

  const portfolioId = String(formData.get("portfolio_id"));
  const symbol = String(formData.get("symbol") || "").toUpperCase().trim();
  const type = String(formData.get("type")) as RuleType;
  const qty = Number(formData.get("qty") || 0);
  const mode = String(formData.get("mode") || "simulate");
  const validUntil = formData.get("valid_until") ? String(formData.get("valid_until")) : null;

  let instrumentId: string | null = null;
  let entryPriceCents: number | null = null;
  if (symbol) {
    const { data: inst } = await sb.from("instruments").select("id").eq("symbol", symbol).maybeSingle();
    if (!inst) return { ok: false, message: `Unknown symbol ${symbol}.` };
    instrumentId = inst.id;
    // Capture entry price from the current weighted-avg position, if held.
    const { data: pos } = await sb.from("positions").select("avg_cost_cents").eq("portfolio_id", portfolioId).eq("instrument_id", inst.id).maybeSingle();
    entryPriceCents = pos?.avg_cost_cents ?? null;
  }

  // Build params per type from the form.
  let params: RuleParams;
  const price = (name: string) => formData.get(name) ? toCents(Number(formData.get(name))) : undefined;
  const num = (name: string) => (formData.get(name) ? Number(formData.get(name)) : undefined);

  switch (type) {
    case "stop_loss":
      params = { qty, trigger: buildStopTrigger(formData) };
      break;
    case "take_profit":
      params = { qty, trigger: buildTakeTrigger(formData, entryPriceCents) };
      break;
    case "bracket_oco":
      params = { qty, take_profit: buildTakeTrigger(formData, entryPriceCents, "tp_"), stop_loss: buildStopTrigger(formData, "sl_") };
      break;
    case "conditional_entry": {
      const cmode = String(formData.get("entry_mode") || "cross_above");
      params = cmode === "strategy"
        ? { side: (formData.get("side") as "buy" | "sell") || "buy", qty, trigger: { mode: "strategy", strategy: "sma_crossover", fast: num("fast") || 20, slow: num("slow") || 50 } }
        : { side: (formData.get("side") as "buy" | "sell") || "buy", qty, trigger: { mode: cmode as "cross_above" | "cross_below", price_cents: price("cross_price")! } };
      break;
    }
    case "scheduled":
      params = String(formData.get("sched_action")) === "eod_flatten"
        ? { action: "eod_flatten", minutes_before_close: num("minutes_before_close") || 15 }
        : { action: "place_at_open", side: (formData.get("side") as "buy" | "sell") || "buy", qty };
      break;
    case "time_stop":
      params = { qty, trading_days: num("trading_days") || 5 };
      break;
    default:
      return { ok: false, message: "Unknown rule type." };
  }

  // Validation: r_multiple needs a captured entry.
  const ocoGroup = type === "bracket_oco" ? crypto.randomUUID() : null;
  const { error } = await sb.from("rules").insert({
    portfolio_id: portfolioId, instrument_id: instrumentId, type,
    mode: mode === "live" ? "live" : "simulate",
    params, status: "draft", entry_price_cents: entryPriceCents,
    hwm_cents: entryPriceCents, valid_from: new Date().toISOString(),
    valid_until: validUntil, created_by: user.id, oco_group_id: ocoGroup,
  });
  if (error) return { ok: false, message: error.message };

  revalidatePath("/rules");
  return { ok: true, message: `Rule created in ${mode} mode.` };
}

function buildStopTrigger(f: FormData, prefix = ""): StopTrigger {
  const mode = String(f.get(`${prefix}stop_mode`) || "absolute");
  if (mode === "pct_below_entry") return { mode, pct: Number(f.get(`${prefix}stop_pct`) || 5) };
  if (mode === "trailing_pct") return { mode, pct: Number(f.get(`${prefix}stop_pct`) || 8) };
  return { mode: "absolute", price_cents: toCents(Number(f.get(`${prefix}stop_price`) || 0)) };
}
function buildTakeTrigger(f: FormData, entry: number | null, prefix = ""): TakeTrigger {
  const mode = String(f.get(`${prefix}take_mode`) || "absolute");
  if (mode === "pct_gain") return { mode, pct: Number(f.get(`${prefix}take_pct`) || 15) };
  if (mode === "r_multiple") return { mode, r: Number(f.get(`${prefix}take_r`) || 2), initial_risk_cents: entry ? Math.round(entry * 0.05) : 0 };
  return { mode: "absolute", price_cents: toCents(Number(f.get(`${prefix}take_price`) || 0)) };
}

/** Transition a rule's status / mode. */
export async function setRuleStatus(ruleId: string, status: "armed" | "cancelled" | "draft"): Promise<RuleActionResult> {
  const sb = await createServerSupabase();
  const { error } = await sb.from("rules").update({ status }).eq("id", ruleId);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/rules");
  return { ok: true, message: `Rule ${status}.` };
}

export async function setRuleMode(ruleId: string, mode: "simulate" | "live"): Promise<RuleActionResult> {
  const sb = await createServerSupabase();
  const { error } = await sb.from("rules").update({ mode }).eq("id", ruleId);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/rules");
  return { ok: true, message: `Rule set to ${mode}.` };
}

/** Global kill switch — disarms every rule in the portfolio immediately, logged. */
export async function toggleKillSwitch(portfolioId: string, enabled: boolean): Promise<RuleActionResult> {
  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  await sb.from("automation_settings").upsert({
    portfolio_id: portfolioId,
    automation_enabled: enabled,
    killed_at: enabled ? null : new Date().toISOString(),
    killed_by: enabled ? null : user?.id ?? null,
    updated_at: new Date().toISOString(),
  });
  if (!enabled) {
    await sb.from("audit_log").insert({
      actor_id: user?.id, entity: "automation", entity_id: portfolioId,
      action: "kill_switch", diff: { enabled: false, at: new Date().toISOString() },
    });
  }
  revalidatePath("/rules");
  return { ok: true, message: enabled ? "Automation enabled." : "Kill switch thrown — all rules disarmed." };
}
