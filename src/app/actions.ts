"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  activityType,
  billingCycle,
  churnCategory,
  currency,
  dealType,
  health,
  lineItemKind,
  priority,
  segment,
} from "@/db/schema";
import type { MissingField } from "@/domain/gates";
import { canChurn, canEditLineItems, canMoveDeal, canUpdateDeal, canWrite, type Decision } from "@/domain/permissions";
import { getCurrentUser, signIn, signOut } from "@/server/auth";
import { getDealForAuthz } from "@/server/authz";
import { diff } from "@/server/events";
import {
  addLineItem,
  createDeal,
  createOrganization,
  logActivity,
  removeLineItem,
  updateDeal,
  updateOnboarding,
  updateOrganization,
} from "@/server/mutations";
import { isLeadStatus, LEAD_STAGES } from "@/domain/leads";
import { createLead, setLeadStatus, updateLead } from "@/server/leads";
import { churnOrganization, transitionDeal, transitionOnboarding } from "@/server/transitions";

export type ActionState = { ok: boolean; message?: string; missing?: MissingField[] } | null;

// ---------- FormData helpers: empty inputs become null ----------
const text = z.preprocess((v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null), z.string().nullable());
const requiredText = z.string().trim().min(1);
const optNum = z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().finite().nullable());
const num = z.preprocess((v) => (v === "" || v == null ? 0 : Number(v)), z.number().finite());
const optEnum = <T extends [string, ...string[]]>(values: T) =>
  z.preprocess((v) => (v === "" || v == null ? null : v), z.enum(values).nullable());
const list = z.preprocess(
  (v) => (typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : []),
  z.array(z.string()),
);
const intList = z.preprocess(
  (v) => (typeof v === "string" ? v.split(/[,\s]+/).filter(Boolean).map(Number) : []),
  z.array(z.number().int().positive()),
);
const checkbox = z.preprocess((v) => v === "on", z.boolean());

function parse<T extends z.ZodTypeAny>(schema: T, fd: FormData): z.infer<T> | ActionState {
  const res = schema.safeParse(Object.fromEntries(fd));
  if (!res.success) return { ok: false, message: res.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  return res.data;
}
const isFailure = (v: unknown): v is NonNullable<ActionState> =>
  !!v && typeof v === "object" && "ok" in v && (v as { ok: unknown }).ok === false;

// ---------- session ----------

export async function signInAction(fd: FormData) {
  const callbackUrl = String(fd.get("callbackUrl") ?? "");
  // Same-origin paths only.
  await signIn("google", { redirectTo: /^\/(?!\/)/.test(callbackUrl) ? callbackUrl : "/" });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/signin" });
}

// ---------- permissions: denials come back as form errors, never as thrown exceptions ----------

const DEAL_NOT_FOUND: ActionState = { ok: false, message: "Deal not found" };
const denied = (d: Decision): ActionState => (d.ok ? null : { ok: false, message: d.message });

// ---------- deals ----------

export async function moveDealAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await getCurrentUser();
  const dealId = String(fd.get("dealId"));
  const deal = await getDealForAuthz(dealId);
  if (!deal) return DEAL_NOT_FOUND;
  const denial = denied(canMoveDeal(user.role, deal.status));
  if (denial) return denial;
  const res = await transitionDeal(dealId, String(fd.get("stageKey")), user.id);
  revalidatePath("/", "layout");
  return res.ok ? { ok: true } : { ok: false, message: res.error, missing: res.missing };
}

const dealSchema = z.object({
  dealId: z.string().uuid(),
  title: requiredText,
  type: z.enum(dealType.enumValues),
  ownerId: text,
  sdrId: text,
  primaryContactId: text,
  source: text,
  partnerName: text,
  plan: text,
  products: list,
  priority: optEnum(priority.enumValues),
  expectedCloseDate: text,
  billingCycle: optEnum(billingCycle.enumValues),
  currency: z.enum(currency.enumValues),
  contractStart: text,
  contractRenewal: text,
  contractLink: text,
  requiresOnboarding: checkbox,
  lostReason: text,
  lostDetail: text,
});

export async function saveDealAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await getCurrentUser();
  const data = parse(dealSchema, fd);
  if (isFailure(data)) return data;
  const { dealId, ...patch } = data as z.infer<typeof dealSchema>;
  const deal = await getDealForAuthz(dealId);
  if (!deal) return DEAL_NOT_FOUND;
  const denial = denied(canUpdateDeal(user.role, deal.status, Object.keys(diff(deal, patch))));
  if (denial) return denial;
  await updateDeal(dealId, patch, user.id);
  revalidatePath("/", "layout");
  return { ok: true, message: "Saved" };
}

const lineItemSchema = z.object({
  dealId: z.string().uuid(),
  kind: z.enum(lineItemKind.enumValues),
  description: text,
  unitPrice: num,
  quantity: num,
  includedFree: num,
  billingCycle: z.enum(billingCycle.enumValues),
});

export async function addLineItemAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await getCurrentUser();
  const data = parse(lineItemSchema, fd);
  if (isFailure(data)) return data;
  const { dealId, ...item } = data as z.infer<typeof lineItemSchema>;
  const deal = await getDealForAuthz(dealId);
  if (!deal) return DEAL_NOT_FOUND;
  const denial = denied(canEditLineItems(user.role, deal.status));
  if (denial) return denial;
  await addLineItem(dealId, item, user.id);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteLineItemAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await getCurrentUser();
  const dealId = String(fd.get("dealId"));
  const deal = await getDealForAuthz(dealId);
  if (!deal) return DEAL_NOT_FOUND;
  const denial = denied(canEditLineItems(user.role, deal.status));
  if (denial) return denial;
  await removeLineItem(dealId, String(fd.get("itemId")), user.id);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function createDealAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await getCurrentUser();
  const denial = denied(canWrite(user.role));
  if (denial) return denial;
  const data = parse(
    z.object({ orgId: z.string().uuid(), title: requiredText, type: z.enum(dealType.enumValues), ownerId: text }),
    fd,
  );
  if (isFailure(data)) return data;
  const deal = await createDeal(data as { orgId: string; title: string; type: (typeof dealType.enumValues)[number]; ownerId: string | null }, user.id);
  revalidatePath("/", "layout");
  redirect(`/deals/${deal.id}`);
}

// ---------- organizations ----------

export async function createOrganizationAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await getCurrentUser();
  const denial = denied(canWrite(user.role));
  if (denial) return denial;
  const data = parse(z.object({ name: requiredText, website: text, aeId: text }), fd);
  if (isFailure(data)) return data;
  const org = await createOrganization(data as { name: string; website: string | null; aeId: string | null }, user.id);
  revalidatePath("/", "layout");
  redirect(`/companies/${org.id}`);
}

const orgSchema = z.object({
  orgId: z.string().uuid(),
  name: requiredText,
  website: text,
  segment: optEnum(segment.enumValues),
  industry: text,
  hqCity: text,
  aeId: text,
  omId: text,
  csmId: text,
  lcAccountIds: intList,
  chargebeeCustomerId: text,
  clientChannel: text,
  health: optEnum(health.enumValues),
  healthNote: text,
});

export async function saveOrganizationAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await getCurrentUser();
  const denial = denied(canWrite(user.role));
  if (denial) return denial;
  const data = parse(orgSchema, fd);
  if (isFailure(data)) return data;
  const { orgId, ...patch } = data as z.infer<typeof orgSchema>;
  await updateOrganization(orgId, patch, user.id);
  revalidatePath("/", "layout");
  return { ok: true, message: "Saved" };
}

const churnSchema = z.object({
  orgId: z.string().uuid(),
  churnedAt: requiredText,
  category: z.enum(churnCategory.enumValues),
  reason: z.string(),
  lastBillingDate: z.string(),
});

export async function churnAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await getCurrentUser();
  const denial = denied(canChurn(user.role));
  if (denial) return denial;
  const data = parse(churnSchema, fd);
  if (isFailure(data)) return data;
  const { orgId, ...input } = data as z.infer<typeof churnSchema>;
  const res = await churnOrganization(orgId, input, user.id);
  revalidatePath("/", "layout");
  return res.ok ? { ok: true, message: "Marked as churned" } : { ok: false, message: res.error, missing: res.missing };
}

// ---------- onboarding ----------

export async function moveOnboardingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await getCurrentUser();
  const denial = denied(canWrite(user.role));
  if (denial) return denial;
  const res = await transitionOnboarding(String(fd.get("onboardingId")), String(fd.get("stageKey")), user.id);
  revalidatePath("/", "layout");
  return res.ok ? { ok: true } : { ok: false, message: res.error, missing: res.missing };
}

const onboardingSchema = z.object({
  onboardingId: z.string().uuid(),
  omId: text,
  kickoffDate: text,
  goLiveDate: text,
  health: optEnum(health.enumValues),
  nps: optNum,
  voiceAdoption: text,
  notes: text,
});

export async function saveOnboardingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await getCurrentUser();
  const denial = denied(canWrite(user.role));
  if (denial) return denial;
  const data = parse(onboardingSchema, fd);
  if (isFailure(data)) return data;
  const { onboardingId, ...patch } = data as z.infer<typeof onboardingSchema>;
  await updateOnboarding(onboardingId, patch, user.id);
  revalidatePath("/", "layout");
  return { ok: true, message: "Saved" };
}

// ---------- activities ----------

const activitySchema = z.object({
  orgId: z.string().uuid(),
  dealId: text,
  contactId: text,
  type: z.enum(activityType.enumValues),
  subject: requiredText,
  body: text,
});

export async function logActivityAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await getCurrentUser();
  const denial = denied(canWrite(user.role));
  if (denial) return denial;
  const data = parse(activitySchema, fd);
  if (isFailure(data)) return data;
  await logActivity({ ...(data as z.infer<typeof activitySchema>), ownerId: user.id, completedAt: new Date() }, user.id);
  revalidatePath("/", "layout");
  return { ok: true };
}

// ---------- leads ----------

const bant = z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().min(0).max(25).nullable());

const newLeadSchema = z.object({
  name: requiredText,
  email: text,
  phone: text,
  designation: text,
  companyName: requiredText,
  website: text,
  source: text,
  ownerId: text,
  sdrId: text,
});

export async function createLeadAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await getCurrentUser();
  const denial = denied(canWrite(user.role));
  if (denial) return denial;
  const data = parse(newLeadSchema, fd);
  if (isFailure(data)) return data;
  const lead = await createLead(data as z.infer<typeof newLeadSchema>, user.id);
  revalidatePath("/", "layout");
  redirect(`/leads/${lead.id}`);
}

const leadSchema = z.object({
  contactId: z.string().uuid(),
  name: requiredText,
  email: text,
  phone: text,
  designation: text,
  linkedinUrl: text,
  isDecisionMaker: checkbox,
  leadStage: optEnum(Object.keys(LEAD_STAGES) as [string, ...string[]]),
  source: text,
  partnerName: text,
  productInterest: list,
  bantBudget: bant,
  bantAuthority: bant,
  bantNeed: bant,
  bantTimeline: bant,
  meetingScheduledAt: text,
  meetingCompletedAt: text,
  disqualifiedReason: text,
  ownerId: text,
  sdrId: text,
});

export async function saveLeadAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await getCurrentUser();
  const denial = denied(canWrite(user.role));
  if (denial) return denial;
  const data = parse(leadSchema, fd);
  if (isFailure(data)) return data;
  const { contactId, ...patch } = data as z.infer<typeof leadSchema>;
  await updateLead(contactId, patch, user.id);
  revalidatePath("/", "layout");
  return { ok: true, message: "Saved" };
}

export async function moveLeadAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await getCurrentUser();
  const denial = denied(canWrite(user.role));
  if (denial) return denial;
  const status = fd.get("stageKey");
  if (!isLeadStatus(status)) return { ok: false, message: "Unknown lead status" };
  const res = await setLeadStatus(String(fd.get("contactId")), status, user.id);
  revalidatePath("/", "layout");
  if (!res.ok) return { ok: false, message: res.error, missing: res.missing };
  if (res.dealCreated) return { ok: true, message: "Deal created for this company" };
  if (res.dealId) return { ok: true, message: "Linked to the company's open deal" };
  return { ok: true };
}
