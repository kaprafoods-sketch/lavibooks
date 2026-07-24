import type { Cents, Qty } from "./money";

export type Side = "buy" | "sell";
export type OrderType = "market" | "limit" | "stop";
export type OrderStatus =
  | "pending"
  | "partial"
  | "filled"
  | "cancelled"
  | "rejected";
export type PortfolioKind = "manual" | "algo";
export type Role = "owner" | "advisor" | "read_only" | "client";

export interface Quote {
  symbol: string;
  lastPriceCents: Cents;
  prevCloseCents: Cents | null;
  fetchedAt: string; // ISO
  isDelayed: boolean;
  source: string;
}

export interface Bar {
  d: string; // YYYY-MM-DD
  openCents: Cents;
  highCents: Cents;
  lowCents: Cents;
  closeCents: Cents;
  volume: number;
}

export interface InstrumentRef {
  symbol: string;
  name?: string;
  exchange?: string;
}

/** An immutable FIFO lot: qty remaining + per-share cost basis in cents. */
export interface Lot {
  id: string;
  qtyOpen: Qty;
  qtyOriginal: Qty;
  costCents: Cents; // per share
  openedAt: string;
}

export interface CashLedgerRow {
  amountCents: Cents; // signed
  reason: "deposit" | "buy" | "sell" | "commission" | "adjustment";
}

export interface OrderIntent {
  side: Side;
  type: OrderType;
  qty: Qty;
  limitPriceCents?: Cents;
  stopPriceCents?: Cents;
}

export interface Fill {
  qty: Qty;
  priceCents: Cents; // includes slippage
  commissionCents: Cents;
}

export interface SimConfig {
  slippageBps: number;
  commissionCents: Cents;
}
