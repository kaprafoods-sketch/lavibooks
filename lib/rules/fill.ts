import type { Cents } from "../money";
import { priceWithSlippage } from "../money";
import type { Bar, Side } from "../types";

/**
 * Gap-aware fill pricing for a TRIGGERED rule. A stop is a trigger, not a
 * guaranteed price:
 *
 *  • Normal case: fill at the bar close ± slippage.
 *  • GAP: for a sell-stop, if the bar opens BELOW the stop level (i.e. the market
 *    gapped through it), fill at the OPEN, not the stop — and record the gap
 *    slippage (stop − open). Symmetric for a buy-stop that gaps up.
 *
 * Limit fills require the bar's range to actually trade through the limit.
 */

export interface FillResult {
  priceCents: Cents;
  gapSlippageCents: Cents; // 0 unless a gap fill occurred
}

/** Fill for a stop that triggered at `stopLevelCents` this bar. */
export function stopFill(
  side: Side, bar: Bar, stopLevelCents: Cents, slippageBps: number,
): FillResult {
  if (side === "sell") {
    // Sell-stop: gap down through the stop → fill at the open.
    if (bar.openCents < stopLevelCents) {
      const px = priceWithSlippage(bar.openCents, "sell", slippageBps);
      return { priceCents: px, gapSlippageCents: stopLevelCents - bar.openCents };
    }
  } else {
    // Buy-stop: gap up through the stop → fill at the open.
    if (bar.openCents > stopLevelCents) {
      const px = priceWithSlippage(bar.openCents, "buy", slippageBps);
      return { priceCents: px, gapSlippageCents: bar.openCents - stopLevelCents };
    }
  }
  // No gap: fill at close with normal slippage.
  return { priceCents: priceWithSlippage(bar.closeCents, side, slippageBps), gapSlippageCents: 0 };
}

/** Market fill at the latest price with slippage (non-stop triggers). */
export function marketFill(side: Side, lastPriceCents: Cents, slippageBps: number): FillResult {
  return { priceCents: priceWithSlippage(lastPriceCents, side, slippageBps), gapSlippageCents: 0 };
}

/** Whether a limit order can fill against a bar (price traded through the limit). */
export function limitFills(side: Side, bar: Bar, limitCents: Cents): boolean {
  return side === "buy" ? bar.lowCents <= limitCents : bar.highCents >= limitCents;
}
