import type { Deal, DealLineItem, Onboarding, Organization, Stage } from "@/db/schema";
import { isOneTime } from "./mrr";

/**
 * Stage gates: fields that must be filled before a record may enter a stage.
 * Field keys are stored on `stages.required_fields`; this registry says how to check each one.
 * Seeded from Salesmate's conditional-required rules (docs/salesmate-inventory.md §3).
 */

export type GateContext = {
  deal?: Pick<
    Deal,
    | "ownerId"
    | "type"
    | "plan"
    | "products"
    | "priority"
    | "expectedCloseDate"
    | "billingCycle"
    | "contractStart"
    | "contractRenewal"
    | "contractLink"
    | "lostReason"
  >;
  lineItems?: Pick<DealLineItem, "kind" | "unitPrice" | "billingCycle">[];
  org: Pick<Organization, "website" | "hqCity" | "segment" | "lcAccountIds" | "csmId">;
  onboarding?: Pick<Onboarding, "kickoffDate" | "nps" | "omId">;
};

type GateField = { label: string; check: (ctx: GateContext) => boolean };

const filled = (v: unknown) =>
  v !== null && v !== undefined && !(typeof v === "string" && v.trim() === "") && !(Array.isArray(v) && v.length === 0);

export const GATE_FIELDS = {
  "deal.owner": { label: "Account Executive", check: (c) => filled(c.deal?.ownerId) },
  "deal.type": { label: "Deal type", check: (c) => filled(c.deal?.type) },
  "deal.plan": { label: "Plan", check: (c) => filled(c.deal?.plan) },
  "deal.products": { label: "Products", check: (c) => filled(c.deal?.products) },
  "deal.priority": { label: "Priority", check: (c) => filled(c.deal?.priority) },
  "deal.expected_close_date": { label: "Expected close date", check: (c) => filled(c.deal?.expectedCloseDate) },
  "deal.pricing": {
    label: "Recurring pricing (at least one priced recurring line item)",
    check: (c) => (c.lineItems ?? []).some((i) => !isOneTime(i) && i.unitPrice > 0),
  },
  "deal.implementation_fee": {
    label: "Implementation fee line item (₹0 is allowed)",
    check: (c) => (c.lineItems ?? []).some((i) => i.kind === "implementation_fee"),
  },
  "deal.billing_cycle": { label: "Billing cycle", check: (c) => filled(c.deal?.billingCycle) },
  "deal.contract_start": { label: "Contract start date", check: (c) => filled(c.deal?.contractStart) },
  "deal.contract_renewal": { label: "Contract renewal date", check: (c) => filled(c.deal?.contractRenewal) },
  "deal.contract_link": { label: "Contract link", check: (c) => filled(c.deal?.contractLink) },
  "deal.lost_reason": { label: "Lost reason", check: (c) => filled(c.deal?.lostReason) },
  "org.website": { label: "Company website", check: (c) => filled(c.org.website) },
  "org.hq_city": { label: "Company HQ city", check: (c) => filled(c.org.hqCity) },
  "org.segment": { label: "Company segment", check: (c) => filled(c.org.segment) },
  "org.lc_account_id": { label: "LC Account ID", check: (c) => filled(c.org.lcAccountIds) },
  "org.csm": { label: "CSM owner", check: (c) => filled(c.org.csmId) },
  "onboarding.om": { label: "Onboarding manager", check: (c) => filled(c.onboarding?.omId) },
  "onboarding.kickoff_date": { label: "Kick-off date", check: (c) => filled(c.onboarding?.kickoffDate) },
  "onboarding.nps": { label: "NPS", check: (c) => filled(c.onboarding?.nps) },
} satisfies Record<string, GateField>;

export type GateFieldKey = keyof typeof GATE_FIELDS;

export function isGateFieldKey(key: string): key is GateFieldKey {
  return key in GATE_FIELDS;
}

/**
 * Field keys required to enter `target`. Moving forward through open/won stages
 * accumulates every earlier stage's requirements, so skipping a stage can't skip its gate.
 * Lost/hold stages only require their own fields.
 */
export function requiredFieldsFor(
  pipelineStages: Pick<Stage, "pipeline" | "position" | "kind" | "requiredFields">[],
  target: Pick<Stage, "pipeline" | "position" | "kind" | "requiredFields">,
): GateFieldKey[] {
  const keys = new Set<string>(target.requiredFields);
  if (target.kind === "open" || target.kind === "won") {
    for (const s of pipelineStages) {
      if (s.pipeline === target.pipeline && (s.kind === "open" || s.kind === "won") && s.position <= target.position) {
        s.requiredFields.forEach((k) => keys.add(k));
      }
    }
  }
  return [...keys].filter(isGateFieldKey);
}

export type MissingField = { key: string; label: string };

export function missingFields(ctx: GateContext, keys: GateFieldKey[]): MissingField[] {
  return keys.filter((k) => !GATE_FIELDS[k].check(ctx)).map((k) => ({ key: k, label: GATE_FIELDS[k].label }));
}
