/**
 * The transform's output and the load's input: LimeCRM rows with ids pre-assigned and users referenced
 * by email (load resolves emails to user ids). Written to <snapshot>/out/plan.json.
 */
import type { Activity, Contact, Deal, DealLineItem, Onboarding, Organization, User } from "@/db/schema";

export type PlanUser = { email: string; name: string; role: User["role"]; isActive: boolean; salesmateUserId: number };

export type PlanOrg = Pick<
  Organization,
  | "id"
  | "name"
  | "website"
  | "websiteTrafficRange"
  | "segment"
  | "industry"
  | "hqCity"
  | "lifecycle"
  | "lcAccountIds"
  | "chargebeeCustomerId"
  | "health"
  | "healthNote"
  | "churnedAt"
  | "churnCategory"
  | "churnReason"
  | "churnLastBillingDate"
  | "salesmateCompanyId"
> & {
  aeEmail: string | null;
  omEmail: string | null;
  csmEmail: string | null;
  /** All Salesmate companies merged into this organization (the schema keeps only one). */
  salesmateCompanyIds: number[];
  groupKeys: string[];
  createdAt: string | null;
};

export type PlanContact = Pick<
  Contact,
  | "id"
  | "orgId"
  | "name"
  | "email"
  | "phone"
  | "designation"
  | "leadStatus"
  | "leadStage"
  | "source"
  | "partnerName"
  | "productInterest"
  | "meetingScheduledAt"
  | "meetingCompletedAt"
  | "qualifiedAt"
  | "sqlAt"
  | "salesmateContactId"
> & { ownerEmail: string | null };

export type PlanLineItem = Pick<DealLineItem, "kind" | "description" | "unitPrice" | "quantity" | "includedFree" | "billingCycle" | "tiers" | "position">;

export type PlanDeal = Pick<
  Deal,
  | "id"
  | "orgId"
  | "primaryContactId"
  | "title"
  | "type"
  | "status"
  | "source"
  | "partnerName"
  | "plan"
  | "products"
  | "priority"
  | "expectedCloseDate"
  | "endedAt"
  | "lostReason"
  | "lostDetail"
  | "billingCycle"
  | "currency"
  | "contractStart"
  | "contractRenewal"
  | "contractLink"
  | "requiresOnboarding"
  | "mrr"
  | "oneTimeFee"
  | "salesmateDealIds"
> & {
  stageKey: string;
  ownerEmail: string | null;
  closedAt: string | null;
  createdAt: string | null;
  lineItems: PlanLineItem[];
  groupKey: string;
  confidence: string;
  mrrSource: string;
};

export type PlanOnboarding = Pick<
  Onboarding,
  "id" | "orgId" | "dealId" | "kickoffDate" | "goLiveDate" | "health" | "nps" | "voiceAdoption" | "notes"
> & {
  stageKey: string;
  omEmail: string | null;
  completedAt: string | null;
  createdAt: string | null;
  salesmateDealId: number | null;
};

export type PlanActivity = Pick<Activity, "id" | "type" | "subject" | "body" | "orgId" | "dealId" | "contactId"> & {
  ownerEmail: string | null;
  dueAt: string | null;
  completedAt: string | null;
  createdAt: string | null;
  salesmateActivityId: number;
};

/** One Salesmate CS "Active Deals" deal: the reference MRR book we reconcile against. */
export type BaselineRow = { dealId: number; title: string; value: number; segment: string; owner: string; orgId: string | null };

export type Flag = {
  kind: string;
  severity: "review" | "info";
  groupKey: string | null;
  org: string | null;
  salesmateDealIds: number[];
  detail: string;
};

export type Plan = {
  snapshot: string;
  generatedAt: string;
  users: PlanUser[];
  orgs: PlanOrg[];
  contacts: PlanContact[];
  deals: PlanDeal[];
  onboardings: PlanOnboarding[];
  activities: PlanActivity[];
  baseline: BaselineRow[];
  flags: Flag[];
  stats: Record<string, number>;
  unresolvedFields: string[];
};
