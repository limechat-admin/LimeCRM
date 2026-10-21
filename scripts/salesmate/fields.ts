/**
 * Salesmate custom fields we migrate, by label (docs/salesmate-inventory.md §4).
 *
 * Salesmate stores custom fields under opaque keys (textCustomField9, decimalCustomField3, ...).
 * Keys are resolved from the field-metadata snapshot by label; `key` pins the ones already
 * decoded in docs/PLAN.md §2.3 and is the fallback when metadata isn't available.
 * If the report lists a field as unresolved, look it up in out/custom-fields.csv and pin its key here.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { get, type Raw } from "./lib/raw";
import { readJson } from "./lib/util";

type FieldDef = { labels: string[]; key?: string };

export const DEAL_FIELDS = {
  // Commercial / rate card
  monthlyInvoiceValue: { labels: ["Monthly Invoice value (In Billing Currency)", "Monthly Invoice value"] },
  billingCurrency: { labels: ["Billing Currency"] },
  billingCycle: { labels: ["Billing Cycle"] },
  implementationFees: { labels: ["Implementation Fees"] },
  perAgentFee: { labels: ["Per Agent Fee"] },
  freeAgents: { labels: ["Free Agents"] },
  costPerBotSession: { labels: ["Cost Per Bot Session"] },
  costPerSession: { labels: ["Cost per Session"] },
  freeBotSessions: { labels: ["Free Bot Sessions (If Any)", "Free Bot Sessions"] },
  botSlabPricing: { labels: ["Bot slab pricing"] },
  slabT0a: { labels: ["T0 (0-1k)", "T0 (0 - 1k)"] },
  slabT0b: { labels: ["T0 (1-2k)", "T0 (1 - 2k)"] },
  slabT1: { labels: ["T1 (2-5k)", "T1 (2 - 5k)"] },
  slabT2: { labels: ["T2 (5-10k)", "T2 (5 - 10k)"] },
  slabT3: { labels: ["T3 (10-15k)", "T3 (10 - 15k)"] },
  slabT4: { labels: ["T4 (15-20k)", "T4 (15 - 20k)"] },
  slabT5: { labels: ["T5 (20-25k)", "T5 (20 - 25k)"] },
  slabT6: { labels: ["T6 (25k+)", "T6 (25k +)"] },
  waMarketing: { labels: ["WhatsApp Marketing Charge"] },
  waUtility: { labels: ["WhatsApp Utility Charge"] },
  costPerMinute: { labels: ["Cost Per Minute"] },
  freeVoiceMinutes: { labels: ["Free Voice Minutes (If Any)", "Free Voice Minutes"] },
  inboundCalling: { labels: ["Inbound calling"] },
  outboundCalling: { labels: ["Outbound calling"] },
  outboundCost: { labels: ["Outbound Cost"] },
  costPerSms: { labels: ["Cost Per SMS"] },
  costPerEmail: { labels: ["Cost per Email"] },
  imageAiCost: { labels: ["Image AI Cost"] },
  plan: { labels: ["Plan"], key: "textCustomField37" },
  productType: { labels: ["Product Type"], key: "multiSelectCustomField8" },
  productsInScope: { labels: ["Products in Scope"] },
  typeOfBot: { labels: ["Type of Bot"] },
  businessType: { labels: ["Business Type"] },
  // Contract & billing
  contractStart: { labels: ["Contract Start Date"] },
  contractRenew: { labels: ["Contract Renew date", "Contract Renewal Date"] },
  contractLink: { labels: ["Contract Link"] },
  chargebeeSubscriptionId: { labels: ["Chargebee Subscription ID"] },
  billingStatus: { labels: ["Billing Status"] },
  lcAccountId: { labels: ["LC Account ID"] },
  // Classification (four overlapping concepts collapse into organizations.segment)
  segment: { labels: ["Segment"], key: "textCustomField14" },
  companyType: { labels: ["Company Type"] },
  dealLevel: { labels: ["Deal Level"] },
  natureOfAccount: { labels: ["Nature Of The Account"] },
  accountClassifier: { labels: ["Account Classifier"] },
  industry: { labels: ["Industry"] },
  hqCity: { labels: ["HQ City", "City"], key: "textCustomField27" },
  websiteTrafficRange: { labels: ["Website Traffic Range (Cloned)", "Website Traffic Range"] },
  brandWebsite: { labels: ["Brand Website"] },
  // Sales process
  dealType: { labels: ["Deal Type"], key: "textCustomField9" },
  accountExecutive: { labels: ["Account Executive"] },
  sdr: { labels: ["SDR"] },
  contactSource: { labels: ["Contact Source (Cloned)", "Contact Source"] },
  partnerName: { labels: ["Partner Name"] },
  whyClosedLost: { labels: ["Why Closed Lost?", "Why Closed Lost"] },
  closeDate: { labels: ["Close Date"] },
  // Onboarding
  kickoffDate: { labels: ["Kickoff Date"] },
  handedToOnboardingDate: { labels: ["Handed to onboarding date"] },
  onbHealth: { labels: ["Onb Account Health"] },
  botGoLiveDate: { labels: ["Bot Go Live Date"] },
  voiceAdoption: { labels: ["VOICE Adoption"] },
  nps: { labels: ["NPS"] },
  // Customer success & churn
  csHealth: { labels: ["Health (CSM Pulse)"] },
  healthRationale: { labels: ["Health Rating Rationale"] },
  churnCategory: { labels: ["Churn Category"] },
  churnReason: { labels: ["Churn reason description"] },
  churnCommunicationDate: { labels: ["Churn Communication Date"] },
  churnLastBillingDate: { labels: ["Churn - last billing date", "Churn – last billing date", "Churn last billing date"] },
  misChurnDate: { labels: ["MIS Churn Date"] },
} satisfies Record<string, FieldDef>;

export const COMPANY_FIELDS = {
  lcAccountId: { labels: ["LC Account ID"] },
  chargebeeCustomerId: { labels: ["Chargebee Customer ID"] },
  brandWebsite: { labels: ["Brand Website"] },
  domain: { labels: ["Company Domain Name"] },
  websiteTrafficRange: { labels: ["Website Traffic Range"] },
} satisfies Record<string, FieldDef>;

export const CONTACT_FIELDS = {
  leadStage: { labels: ["Lead Stage -Label Dropdown", "Lead Stage"] },
  leadStatus: { labels: ["Lead Status Drop Down", "Lead Status"] },
  contactSource: { labels: ["Contact Source"] },
  designation: { labels: ["Designation"] },
  productType: { labels: ["Product Type"] },
  partnerName: { labels: ["Partner Name"] },
  meetingScheduledDate: { labels: ["Meeting Scheduled Date", "meeting scheduled date"] },
  meetingCompletedDate: { labels: ["meeting completed date", "Meeting Completed Date"] },
  qualifiedMeetingDate: { labels: ["Qualified meeting date"] },
  sqlDate: { labels: ["SQL date", "Sales Qualified Date", "Sales Qualification Date"] },
} satisfies Record<string, FieldDef>;

export type DealField = keyof typeof DEAL_FIELDS;
export type CompanyField = keyof typeof COMPANY_FIELDS;
export type ContactField = keyof typeof CONTACT_FIELDS;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Every {key, label} pair found anywhere in a metadata payload, whatever its exact shape. */
function metadataLabels(payload: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (typeof v !== "object" || v === null) return;
    const o = v as Raw;
    const key = [o.fieldName, o.name, o.systemName, o.apiName].find((k) => typeof k === "string" && /CustomField\d+$/.test(k));
    const label = [o.displayName, o.label, o.fieldLabel, o.title].find((l) => typeof l === "string");
    if (typeof key === "string" && typeof label === "string") out.set(norm(label), key.replace(/^\w+\./, ""));
    Object.values(o).forEach(walk);
  };
  walk(payload);
  return out;
}

export type Resolved<K extends string> = {
  keys: Partial<Record<K, string>>;
  unresolved: K[];
  source: Partial<Record<K, "metadata" | "pinned">>;
};

export function resolveFields<K extends string>(defs: Record<K, FieldDef>, snapshotDir: string, module: string): Resolved<K> {
  const metaPath = join(snapshotDir, "meta", `fields-${module}.json`);
  const labels = existsSync(metaPath) ? metadataLabels(readJson<unknown>(metaPath)) : new Map<string, string>();
  const res: Resolved<K> = { keys: {}, unresolved: [], source: {} };
  for (const name of Object.keys(defs) as K[]) {
    const def = defs[name];
    const fromMeta = def.labels.map((l) => labels.get(norm(l))).find(Boolean);
    if (fromMeta) {
      res.keys[name] = fromMeta;
      res.source[name] = "metadata";
    } else if (def.key) {
      res.keys[name] = def.key;
      res.source[name] = "pinned";
    } else res.unresolved.push(name);
  }
  return res;
}

/** Reader for one record: `f("plan")` → raw value, trying both `key` and `customFields.key`. */
export function fieldReader<K extends string>(resolved: Resolved<K>, record: Raw) {
  return (name: K): unknown => {
    const key = resolved.keys[name];
    if (!key) return undefined;
    return get(record, key) ?? get(record, `customFields.${key}`);
  };
}
