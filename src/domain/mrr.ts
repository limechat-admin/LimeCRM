import type { DealLineItem } from "@/db/schema";

export type BillingCycle = DealLineItem["billingCycle"];

export type PricedItem = Pick<
  DealLineItem,
  "kind" | "unitPrice" | "quantity" | "includedFree" | "billingCycle" | "tiers"
>;

const MONTHS: Record<Exclude<BillingCycle, "one_time">, number> = {
  monthly: 1,
  quarterly: 3,
  semi_annual: 6,
  annual: 12,
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function isOneTime(item: Pick<PricedItem, "kind" | "billingCycle">) {
  return item.kind === "implementation_fee" || item.billingCycle === "one_time";
}

/**
 * Unit price for a billable quantity. With tiers this is volume pricing:
 * every unit is charged at the rate of the slab the total falls into
 * (how the Salesmate T0–T6 bot-session slabs are quoted).
 */
export function unitPriceFor(item: Pick<PricedItem, "unitPrice" | "tiers">, billableQty: number) {
  if (!item.tiers?.length) return item.unitPrice;
  const sorted = [...item.tiers].sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity));
  const tier = sorted.find((t) => t.upTo === null || billableQty <= t.upTo) ?? sorted[sorted.length - 1];
  return tier.unitPrice;
}

/** Amount charged for one billing period of this item. */
export function periodAmount(item: PricedItem) {
  const billable = Math.max(item.quantity - item.includedFree, 0);
  return billable * unitPriceFor(item, billable);
}

/** Monthly-normalized recurring value of an item (0 for one-time items). */
export function monthlyValue(item: PricedItem) {
  if (isOneTime(item)) return 0;
  return periodAmount(item) / MONTHS[item.billingCycle as keyof typeof MONTHS];
}

export function dealTotals(items: PricedItem[]) {
  let mrr = 0;
  let oneTimeFee = 0;
  for (const item of items) {
    if (isOneTime(item)) oneTimeFee += periodAmount(item);
    else mrr += monthlyValue(item);
  }
  return { mrr: round2(mrr), oneTimeFee: round2(oneTimeFee) };
}
