import type { QuotationItemKind } from "../types";

export type PricedItem = {
  description: string;
  amount: number;
  kind: QuotationItemKind;
};

function round(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Business rule (server-authoritative): the "total" line is a display-only
 * running total and is excluded from the maths. Discounts are stored as
 * negative amounts.
 */
export function computeTotals(items: PricedItem[]) {
  let subtotal = 0;
  let discount = 0;

  for (const item of items) {
    if (item.kind === "total") continue;
    if (item.kind === "discount") discount += Math.abs(item.amount);
    else subtotal += item.amount;
  }

  return {
    subtotal: round(subtotal),
    discount: round(discount),
    total: round(subtotal - discount),
  };
}
