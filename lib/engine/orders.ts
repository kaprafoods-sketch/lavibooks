import type { Cents, Qty } from "../money";
import { notionalCents, priceWithSlippage } from "../money";
import type {
  CashLedgerRow,
  Fill,
  Lot,
  OrderIntent,
  OrderStatus,
  SimConfig,
} from "../types";
import { buyingPowerCents, checkBuyingPower } from "./ledger";
import { consumeFIFO, openQty } from "./lots";

/**
 * Pure paper-fill engine. Given an order intent, the current last price, the
 * ledger, and the open lots, decide whether/how the order fills and produce the
 * resulting ledger rows + lot mutations. No I/O — the caller persists results.
 */

export interface FillOutcome {
  status: OrderStatus;
  rejectReason?: string;
  fill?: Fill;
  /** New ledger rows to append (buy: negative; sell: positive; commission: negative). */
  ledgerRows: (CashLedgerRow & { refKind: "buy" | "sell" | "commission" })[];
  /** Lots after applying the fill. */
  lots: Lot[];
  /** Realized P&L for a sell (0 for buys). */
  realizedPnlCents: Cents;
}

/**
 * Determine the marketable fill price for the order given the last trade price.
 * Returns null when a LIMIT/STOP is not currently triggerable.
 */
export function fillPrice(
  intent: OrderIntent,
  lastPriceCents: Cents,
  slippageBps: number,
): Cents | null {
  const slipped = priceWithSlippage(lastPriceCents, intent.side, slippageBps);
  switch (intent.type) {
    case "market":
      return slipped;
    case "limit": {
      const lp = intent.limitPriceCents!;
      // Buy limit fills if market <= limit; sell limit fills if market >= limit.
      const triggers = intent.side === "buy" ? lastPriceCents <= lp : lastPriceCents >= lp;
      if (!triggers) return null;
      // Fill at the better of slipped market vs limit (never worse than limit).
      return intent.side === "buy" ? Math.min(slipped, lp) : Math.max(slipped, lp);
    }
    case "stop": {
      const sp = intent.stopPriceCents!;
      // Buy stop triggers when market >= stop; sell stop when market <= stop.
      const triggers = intent.side === "buy" ? lastPriceCents >= sp : lastPriceCents <= sp;
      if (!triggers) return null;
      return slipped; // becomes a market order once triggered
    }
  }
}

export function simulateFill(params: {
  intent: OrderIntent;
  lastPriceCents: Cents;
  ledger: CashLedgerRow[];
  lots: Lot[];
  config: SimConfig;
  now: string;
  newLotId: string;
}): FillOutcome {
  const { intent, lastPriceCents, ledger, lots, config, now, newLotId } = params;

  const px = fillPrice(intent, lastPriceCents, config.slippageBps);
  if (px === null) {
    return {
      status: "pending",
      ledgerRows: [],
      lots,
      realizedPnlCents: 0,
    };
  }

  const commission = config.commissionCents;

  if (intent.side === "buy") {
    const notional = notionalCents(intent.qty, px);
    const bp = buyingPowerCents(ledger);
    const check = checkBuyingPower(bp, notional, commission);
    if (!check.ok) {
      return {
        status: "rejected",
        rejectReason: `Insufficient buying power: need ${check.requiredCents}¢, have ${bp}¢`,
        ledgerRows: [],
        lots,
        realizedPnlCents: 0,
      };
    }
    const newLot: Lot = {
      id: newLotId,
      qtyOpen: intent.qty,
      qtyOriginal: intent.qty,
      costCents: px,
      openedAt: now,
    };
    const rows: FillOutcome["ledgerRows"] = [
      { amountCents: -notional, reason: "buy", refKind: "buy" },
    ];
    if (commission > 0) rows.push({ amountCents: -commission, reason: "commission", refKind: "commission" });
    return {
      status: "filled",
      fill: { qty: intent.qty, priceCents: px, commissionCents: commission },
      ledgerRows: rows,
      lots: [...lots, newLot],
      realizedPnlCents: 0,
    };
  }

  // SELL — must have the shares (no shorting).
  const held = openQty(lots);
  if (intent.qty > held + 1e-9) {
    return {
      status: "rejected",
      rejectReason: `Cannot sell ${intent.qty}: only ${held} shares held (no shorting in v1)`,
      ledgerRows: [],
      lots,
      realizedPnlCents: 0,
    };
  }
  const consumed = consumeFIFO(lots, intent.qty, px);
  const proceeds = notionalCents(intent.qty, px);
  const rows: FillOutcome["ledgerRows"] = [
    { amountCents: proceeds, reason: "sell", refKind: "sell" },
  ];
  if (commission > 0) rows.push({ amountCents: -commission, reason: "commission", refKind: "commission" });
  return {
    status: "filled",
    fill: { qty: intent.qty, priceCents: px, commissionCents: commission },
    ledgerRows: rows,
    lots: consumed.remainingLots,
    realizedPnlCents: consumed.realizedPnlCents - commission,
  };
}
