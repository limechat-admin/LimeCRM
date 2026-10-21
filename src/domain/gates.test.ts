import { describe, expect, it } from "vitest";
import { missingFields, requiredFieldsFor, type GateContext } from "./gates";
import { ONBOARDING_STAGES, SALES_STAGES } from "./stage-config";

const stage = (key: string) => [...SALES_STAGES, ...ONBOARDING_STAGES].find((s) => s.key === key)!;

const baseCtx = (): GateContext => ({
  deal: {
    ownerId: "u1",
    type: "new_business",
    plan: "LimeBot",
    products: ["Chat BOT"],
    priority: "high",
    expectedCloseDate: "2026-11-30",
    billingCycle: null,
    contractStart: null,
    contractRenewal: null,
    contractLink: null,
    lostReason: null,
  },
  lineItems: [],
  org: { website: "https://acme.in", hqCity: "Mumbai", segment: null, lcAccountIds: [], csmId: null },
});

describe("requiredFieldsFor", () => {
  it("accumulates every earlier stage's gate when moving forward", () => {
    const keys = requiredFieldsFor(SALES_STAGES, stage("agreement_signed"));
    expect(keys).toEqual(
      expect.arrayContaining(["deal.owner", "deal.expected_close_date", "deal.pricing", "deal.billing_cycle"]),
    );
    expect(keys).not.toContain("org.lc_account_id");
  });

  it("requires only the lost stage's own fields when closing lost", () => {
    expect(requiredFieldsFor(SALES_STAGES, stage("lost"))).toEqual(["deal.lost_reason"]);
  });

  it("does not mix pipelines", () => {
    const keys = requiredFieldsFor([...SALES_STAGES, ...ONBOARDING_STAGES], stage("handed_to_cs"));
    expect(keys).toContain("onboarding.nps");
    expect(keys).not.toContain("deal.owner");
  });
});

describe("missingFields", () => {
  it("blocks Agreement Sent until recurring pricing and an implementation-fee line exist", () => {
    const ctx = baseCtx();
    const keys = requiredFieldsFor(SALES_STAGES, stage("agreement_sent"));
    expect(missingFields(ctx, keys).map((m) => m.key)).toEqual(["deal.pricing", "deal.implementation_fee"]);

    ctx.lineItems = [
      { kind: "platform_fee", unitPrice: 15000, billingCycle: "monthly" },
      { kind: "implementation_fee", unitPrice: 0, billingCycle: "one_time" },
    ];
    expect(missingFields(ctx, keys)).toEqual([]);
  });

  it("does not accept a one-time fee as recurring pricing", () => {
    const ctx = baseCtx();
    ctx.lineItems = [{ kind: "implementation_fee", unitPrice: 50000, billingCycle: "one_time" }];
    expect(missingFields(ctx, ["deal.pricing"]).map((m) => m.key)).toEqual(["deal.pricing"]);
  });

  it("treats empty strings and empty arrays as missing", () => {
    const ctx = baseCtx();
    ctx.deal!.plan = "  ";
    ctx.deal!.products = [];
    expect(missingFields(ctx, ["deal.plan", "deal.products"]).map((m) => m.key)).toEqual([
      "deal.plan",
      "deal.products",
    ]);
  });
});
