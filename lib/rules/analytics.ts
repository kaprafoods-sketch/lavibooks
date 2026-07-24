import type { SupabaseClient } from "@supabase/supabase-js";
import type { Bar } from "../types";

/**
 * Manual vs automated cohort comparison + stop analytics for the prediction
 * layer. Automated trades carry rule_id; manual trades don't.
 *
 * Stop analytics answers the headline question BOTH ways:
 *  • saved:  a stop fill where price kept falling below the fill → loss avoided.
 *  • shookOut: a stop fill where price recovered above the fill within the
 *    horizon → we got shaken out of a trade that then recovered.
 * Counterfactual uses daily bars after the fill.
 */

export interface Cohort {
  trades: number;
  roundTrips: number;
  hitRatePct: number; // share of profitable round-trips
  avgPnlCents: number;
  avgHoldingDays: number;
  worstDrawdownCents: number;
}

export interface StopAnalytics {
  stopFills: number;
  saved: number; // stop that avoided further loss
  shookOut: number; // stop that exited a trade that recovered
  savedPct: number;
}

export interface AutomationComparison {
  manual: Cohort;
  automated: Cohort;
  stops: StopAnalytics;
}

interface TradeRow {
  instrument_id: string; side: string; qty: number; price_cents: number;
  filled_at: string; rule_id: string | null;
}

function buildCohort(trades: TradeRow[]): Cohort {
  // Pair buys→sells FIFO per instrument to form round-trips.
  const byInst = new Map<string, TradeRow[]>();
  for (const t of trades) {
    if (!byInst.has(t.instrument_id)) byInst.set(t.instrument_id, []);
    byInst.get(t.instrument_id)!.push(t);
  }
  let roundTrips = 0, wins = 0, pnlSum = 0, holdSum = 0, worstDd = 0;
  for (const list of byInst.values()) {
    const buys: TradeRow[] = [];
    for (const t of list.sort((a, b) => a.filled_at.localeCompare(b.filled_at))) {
      if (t.side === "buy") buys.push({ ...t });
      else {
        let remaining = Number(t.qty);
        while (remaining > 0 && buys.length) {
          const lot = buys[0];
          const take = Math.min(remaining, Number(lot.qty));
          const pnl = Math.round(take * (t.price_cents - lot.price_cents));
          pnlSum += pnl; roundTrips++;
          if (pnl > 0) wins++;
          worstDd = Math.min(worstDd, pnl);
          holdSum += (new Date(t.filled_at).getTime() - new Date(lot.filled_at).getTime()) / 86400000;
          lot.qty = Number(lot.qty) - take; remaining -= take;
          if (Number(lot.qty) <= 0) buys.shift();
        }
      }
    }
  }
  return {
    trades: trades.length, roundTrips,
    hitRatePct: roundTrips ? (wins / roundTrips) * 100 : 0,
    avgPnlCents: roundTrips ? Math.round(pnlSum / roundTrips) : 0,
    avgHoldingDays: roundTrips ? holdSum / roundTrips : 0,
    worstDrawdownCents: worstDd,
  };
}

export async function getAutomationComparison(
  sb: SupabaseClient, portfolioId: string,
): Promise<AutomationComparison> {
  const { data: trades } = await sb.from("trades")
    .select("instrument_id,side,qty,price_cents,filled_at,rule_id")
    .eq("portfolio_id", portfolioId).order("filled_at", { ascending: true });
  const all = (trades ?? []) as TradeRow[];

  const manual = buildCohort(all.filter((t) => !t.rule_id));
  const automated = buildCohort(all.filter((t) => t.rule_id));

  // Stop analytics: automated sells whose originating rule is a stop_loss.
  const { data: stopRules } = await sb.from("rules")
    .select("id").eq("portfolio_id", portfolioId).eq("type", "stop_loss");
  const stopRuleIds = new Set((stopRules ?? []).map((r) => r.id));
  const stopFills = all.filter((t) => t.side === "sell" && t.rule_id && stopRuleIds.has(t.rule_id));

  let saved = 0, shookOut = 0;
  for (const f of stopFills) {
    // Look at daily bars in the ~10 trading days after the fill.
    const { data: bars } = await sb.from("daily_bars")
      .select("d,close_cents").eq("instrument_id", f.instrument_id)
      .gt("d", f.filled_at.slice(0, 10)).order("d", { ascending: true }).limit(10);
    const closes = (bars ?? []).map((b) => (b as { close_cents: number }).close_cents);
    if (!closes.length) continue;
    const recovered = closes.some((c) => c > f.price_cents);
    if (recovered) shookOut++; else saved++;
  }

  return {
    manual, automated,
    stops: {
      stopFills: stopFills.length, saved, shookOut,
      savedPct: stopFills.length ? (saved / stopFills.length) * 100 : 0,
    },
  };
}
