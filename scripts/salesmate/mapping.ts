/** Salesmate picklist values → LimeCRM enums and stage keys (src/domain/stage-config.ts). */
import type { Activity, Deal, Organization } from "@/db/schema";
import type { LeadStatus, LEAD_STAGES } from "@/domain/leads";

const key = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Sales Pipeline stage → LimeCRM sales stage key. Pre-qualification stages land on the first LimeCRM stage. */
const SALES_STAGE: Record<string, string> = {
  new: "qualified_meeting",
  contacted: "qualified_meeting",
  "qualified meetings": "qualified_meeting",
  "sales qualified leads": "sql",
  "ongoing discussion": "ongoing_discussion",
  "commercial discussion": "commercial_discussion",
  "in negotiation": "commercial_discussion",
  "agreement sent": "agreement_sent",
  "agreement signed": "agreement_signed",
  "invoice raised": "invoice_raised",
  "handed to onboarding": "won",
  "handed to cs": "won",
  "closed lost": "lost",
  "sales churn": "never_paid",
};

/** Default (HubSpot-legacy) pipeline uses similar names. */
const DEFAULT_STAGE: Record<string, string> = {
  "proposal presented": "agreement_sent",
};

export function salesStageKey(stage: string): string | null {
  return SALES_STAGE[key(stage)] ?? DEFAULT_STAGE[key(stage)] ?? null;
}

export type ObState =
  | { kind: "stage"; key: string; completed: boolean }
  | { kind: "churned" };

const OB_STAGE: Record<string, ObState> = {
  "new untouched": { kind: "stage", key: "not_started", completed: false },
  "not started": { kind: "stage", key: "not_started", completed: false },
  "on sales": { kind: "stage", key: "not_started", completed: false },
  "kick off pending": { kind: "stage", key: "kickoff_pending", completed: false },
  "implementation in progress": { kind: "stage", key: "implementation", completed: false },
  "implementation done": { kind: "stage", key: "implementation_done", completed: false },
  hypercare: { kind: "stage", key: "hypercare", completed: false },
  "handed to customer success from ob": { kind: "stage", key: "handed_to_cs", completed: true },
  "on hold billing": { kind: "stage", key: "on_hold_billing", completed: false },
  "billing poc completed": { kind: "stage", key: "on_hold_billing", completed: false },
  churned: { kind: "churned" },
};

export const obState = (stage: string): ObState | null => OB_STAGE[key(stage)] ?? null;

export type CsState = "active" | "on_hold" | "churned" | "unclassified";

const CS_STAGE: Record<string, CsState> = {
  "active deals": "active",
  "renewal deal present": "active",
  "billing on hold": "on_hold",
  churned: "churned",
  // "All deals" is an unsorted inbox in the CS pipeline: not counted in Salesmate's Active book.
  "all deals": "unclassified",
};

export const csState = (stage: string): CsState | null => CS_STAGE[key(stage)] ?? null;

/** Salesmate's reference "MRR book": CS pipeline, stage Active Deals. */
export const isCsActiveDeals = (pipeline: string, stage: string) => pipeline === "cs" && key(stage) === "active deals";

export type Segment = NonNullable<Organization["segment"]>;

/**
 * Four overlapping Salesmate concepts → one segment. Nature Of The Account is the most specific,
 * then Company Type / Deal Level / Segment; Account Classifier only contributes "Self - Serve".
 */
export function segmentOf(v: {
  natureOfAccount: string | null;
  companyType: string | null;
  dealLevel: string | null;
  segment: string | null;
  accountClassifier: string | null;
}): { segment: Segment | null; conflict: boolean } {
  const fromNature = (s: string | null): Segment | null => {
    const k = key(s);
    if (!k) return null;
    if (k.includes("enterprise")) return "enterprise";
    if (k.includes("mid")) return "mid_market";
    if (k.includes("dedicated")) return "growth_dedicated";
    if (k.includes("self")) return "growth_self_serve";
    return null;
  };
  const candidates = [v.natureOfAccount, v.companyType, v.dealLevel, v.segment].map(fromNature).filter((s): s is Segment => !!s);
  const classifier = key(v.accountClassifier).includes("self") ? ("growth_self_serve" as const) : null;
  const all = classifier ? [...candidates, classifier] : candidates;
  const segment = all[0] ?? null;
  // Growth sub-segments refine mid-market, so only enterprise vs non-enterprise counts as a conflict.
  const conflict = new Set(all.map((s) => (s === "enterprise" ? "ent" : "non"))).size > 1;
  return { segment, conflict };
}

export function billingCycleOf(s: string | null): Deal["billingCycle"] {
  const k = key(s);
  if (!k) return null;
  if (k.startsWith("month")) return "monthly";
  if (k.startsWith("quarter")) return "quarterly";
  if (k.startsWith("semi")) return "semi_annual";
  if (k.startsWith("annual")) return "annual";
  if (k.startsWith("one")) return "one_time";
  return null;
}

export function priorityOf(s: string | null): Deal["priority"] {
  const k = key(s);
  return k === "high" || k === "medium" || k === "low" ? k : null;
}

export function dealTypeOf(title: string, dealType: string | null, businessType: string | null): Deal["type"] {
  const t = key(title);
  if (/\baddendum\b/.test(t)) return "addendum";
  if (/\bcross ?sell\b/.test(t)) return "cross_sell";
  if (/\bupsell\b|\bup sell\b/.test(t)) return "upsell";
  if (/\brenewal\b/.test(t) || key(dealType) === "renewal") return "renewal";
  const b = key(businessType);
  if (b === "existing expansion") return "upsell";
  if (b === "existing new") return "cross_sell";
  return "new_business";
}

const CHURN: Record<string, NonNullable<Organization["churnCategory"]>> = {
  payment: "payment",
  business: "business",
  "onboarding experience": "onboarding_experience",
  "low value": "low_value",
  "support issues": "support_issues",
  "competition product experience": "competition_product",
  "competition pricing": "competition_pricing",
  "corporate changes": "corporate_changes",
  "did not start with lc": "did_not_start",
  "self serve": "self_serve",
  "product issues gaps": "product_gaps",
  "netcore churn": "partner_churn",
};

export const churnCategoryOf = (s: string | null) => CHURN[key(s)] ?? null;

export function healthOf(s: string | null): Organization["health"] {
  const k = key(s);
  if (["green", "healthy"].includes(k)) return "green";
  if (["yellow", "at risk"].includes(k)) return "yellow";
  if (["red", "might churn", "blocked"].includes(k)) return "red";
  return null;
}

const ACTIVITY: Record<string, Activity["type"]> = {
  call: "call",
  task: "task",
  "meeting set": "meeting",
  meeting: "meeting",
  demo: "demo",
  "mid market activity": "task",
  linkedin: "linkedin",
  "attempted contact": "attempted_contact",
  "email follow up": "email",
  email: "email",
  "whatsapp follow up": "whatsapp",
  whatsapp: "whatsapp",
  note: "note",
};

export const activityTypeOf = (s: string | null): Activity["type"] => ACTIVITY[key(s)] ?? "task";

/** Salesmate "Lead Status Drop Down" → src/domain/leads.ts LEAD_STATUSES. "Partnership Contact" also sets the stage. */
export function leadStatusOf(s: string | null): { status: LeadStatus | null; stage?: keyof typeof LEAD_STAGES } {
  const k = key(s);
  if (!k) return { status: null };
  if (k === "not contacted") return { status: "not_contacted" };
  if (k === "attempted contact") return { status: "attempted_contact" };
  if (k === "ongoing") return { status: "ongoing" };
  if (k.startsWith("deferred")) return { status: "deferred" };
  if (k === "meeting scheduled") return { status: "meeting_scheduled" };
  if (k === "meeting completed" || k === "meeting done with the company") return { status: "meeting_completed" };
  if (k.startsWith("qualified meeting")) return { status: "qualified_meeting" };
  if (k === "sql" || k.startsWith("sql ")) return { status: "sql" };
  if (k.startsWith("disqualified")) return { status: "disqualified" };
  if (k === "duplicate") return { status: "duplicate" };
  if (k === "partnership contact") return { status: "ongoing", stage: "partnership" };
  return { status: null };
}

/** Salesmate "Lead Stage -Label Dropdown" → lead / mgl / mql / sql / partnership (MRL, TBQ, Prospect → lead). */
export function leadStageOf(s: string | null): keyof typeof LEAD_STAGES | null {
  const k = key(s);
  if (!k) return null;
  if (k === "mgl" || k === "mql" || k === "sql" || k === "partnership") return k;
  return "lead";
}
