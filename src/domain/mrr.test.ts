import { describe, expect, it } from "vitest";
import { dealTotals, monthlyValue, unitPriceFor, type PricedItem } from "./mrr";

const item = (over: Partial<PricedItem>): PricedItem => ({
  kind: "platform_fee",
  unitPrice: 0,
  quantity: 1,
  includedFree: 0,
  billingCycle: "monthly",
  tiers: null,
  ...over,
});

describe("monthlyValue", () => {
  it("normalizes non-monthly cycles to a monthly figure", () => {
    expect(monthlyValue(item({ unitPrice: 120000, billingCycle: "annual" }))).toBe(10000);
    expect(monthlyValue(item({ unitPrice: 30000, billingCycle: "quarterly" }))).toBe(10000);
    expect(monthlyValue(item({ unitPrice: 60000, billingCycle: "semi_annual" }))).toBe(10000);
  });

  it("charges only seats above the free allowance", () => {
    expect(monthlyValue(item({ kind: "agent_seat", unitPrice: 1000, quantity: 10, includedFree: 2 }))).toBe(8000);
    expect(monthlyValue(item({ kind: "agent_seat", unitPrice: 1000, quantity: 1, includedFree: 2 }))).toBe(0);
  });

  it("treats usage-only rates (no committed quantity) as zero MRR", () => {
    expect(monthlyValue(item({ kind: "voice_minute", unitPrice: 3, quantity: 0 }))).toBe(0);
  });

  it("never counts one-time items as recurring", () => {
    expect(monthlyValue(item({ kind: "implementation_fee", unitPrice: 50000 }))).toBe(0);
    expect(monthlyValue(item({ unitPrice: 50000, billingCycle: "one_time" }))).toBe(0);
  });
});

describe("unitPriceFor (volume slabs)", () => {
  const tiers = [
    { upTo: 1000, unitPrice: 2 },
    { upTo: 5000, unitPrice: 1.5 },
    { upTo: null, unitPrice: 1 },
  ];
  it("prices all units at the slab the volume falls into", () => {
    expect(unitPriceFor({ unitPrice: 9, tiers }, 800)).toBe(2);
    expect(unitPriceFor({ unitPrice: 9, tiers }, 1000)).toBe(2);
    expect(unitPriceFor({ unitPrice: 9, tiers }, 4000)).toBe(1.5);
    expect(unitPriceFor({ unitPrice: 9, tiers }, 25000)).toBe(1);
  });
  it("falls back to the flat unit price without tiers", () => {
    expect(unitPriceFor({ unitPrice: 9, tiers: null }, 25000)).toBe(9);
  });
});

describe("dealTotals", () => {
  it("splits recurring MRR from one-time fees", () => {
    const totals = dealTotals([
      item({ unitPrice: 15000 }),
      item({ kind: "agent_seat", unitPrice: 1500, quantity: 5, includedFree: 2 }),
      item({ kind: "bot_session", unitPrice: 0, quantity: 4000, tiers: [{ upTo: 5000, unitPrice: 1.5 }] }),
      item({ kind: "implementation_fee", unitPrice: 25000 }),
    ]);
    expect(totals).toEqual({ mrr: 15000 + 4500 + 6000, oneTimeFee: 25000 });
  });
});
