import { and, eq, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { contacts, deals, organizations, stages } from "@/db/schema";
import type { MissingField } from "@/domain/gates";
import { dealStageForLead, leadStatusMissing, type LeadStatus, LEAD_STATUS_LABEL } from "@/domain/leads";
import { diff, recordEvent } from "./events";
import { recomputeOrg } from "./mrr";

export type LeadResult =
  | { ok: true; dealId?: string; dealCreated?: boolean }
  | { ok: false; missing: MissingField[]; error?: string };

/** Find a company by name (case-insensitive) or create it as a prospect. One company record, always. */
async function findOrCreateOrg(tx: Tx, name: string, website: string | null, aeId: string | null, actorId: string) {
  const [existing] = await tx
    .select({ id: organizations.id })
    .from(organizations)
    .where(sql`lower(${organizations.name}) = ${name.trim().toLowerCase()}`);
  if (existing) return existing.id;
  const [org] = await tx.insert(organizations).values({ name: name.trim(), website, aeId }).returning({ id: organizations.id });
  await recordEvent(tx, { entityType: "organization", entityId: org.id, orgId: org.id, actorId, action: "created", data: { name: name.trim(), via: "lead" } });
  return org.id;
}

export type NewLead = {
  name: string;
  email: string | null;
  phone: string | null;
  designation: string | null;
  companyName: string;
  website: string | null;
  source: string | null;
  ownerId: string | null;
  sdrId: string | null;
};

export async function createLead(input: NewLead, actorId: string) {
  return db.transaction(async (tx) => {
    const orgId = await findOrCreateOrg(tx, input.companyName, input.website, input.ownerId, actorId);
    const { name, email, phone, designation, source, ownerId, sdrId } = input;
    const [lead] = await tx
      .insert(contacts)
      .values({ name, email, phone, designation, source, ownerId, sdrId, orgId, leadStatus: "not_contacted", leadStage: "lead" })
      .returning();
    await recordEvent(tx, { entityType: "contact", entityId: lead.id, orgId, actorId, action: "created", data: { name: lead.name } });
    return lead;
  });
}

export type LeadPatch = Partial<
  Pick<
    typeof contacts.$inferInsert,
    | "name"
    | "email"
    | "phone"
    | "designation"
    | "linkedinUrl"
    | "isDecisionMaker"
    | "leadStage"
    | "source"
    | "partnerName"
    | "productInterest"
    | "bantBudget"
    | "bantAuthority"
    | "bantNeed"
    | "bantTimeline"
    | "meetingScheduledAt"
    | "meetingCompletedAt"
    | "disqualifiedReason"
    | "ownerId"
    | "sdrId"
  >
>;

export async function updateLead(id: string, patch: LeadPatch, actorId: string) {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(contacts).where(eq(contacts.id, id));
    if (!before) return;
    const changes = diff(before, patch);
    if (!Object.keys(changes).length) return;
    await tx.update(contacts).set(patch).where(eq(contacts.id, id));
    await recordEvent(tx, { entityType: "contact", entityId: id, orgId: before.orgId, actorId, action: "updated", data: changes });
  });
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Move a lead to a new status, enforcing the SOP's requirements. Reaching Qualified Meeting or SQL
 * opens a deal for the company at the matching Sales stage (Salesmate's "deal auto-created" rule),
 * unless the company already has an open deal, which is reused instead of duplicated.
 */
export async function setLeadStatus(id: string, status: LeadStatus, actorId: string): Promise<LeadResult> {
  return db.transaction(async (tx) => {
    const [lead] = await tx.select().from(contacts).where(eq(contacts.id, id));
    if (!lead) return { ok: false, missing: [], error: "Lead not found" };
    if (lead.leadStatus === status) return { ok: true };

    const missing = leadStatusMissing(lead, status);
    if (missing.length) return { ok: false, missing };

    const patch: Partial<typeof contacts.$inferInsert> = { leadStatus: status };
    if ((status === "qualified_meeting" || status === "sql") && !lead.qualifiedAt) patch.qualifiedAt = today();
    if (status === "sql") {
      patch.sqlAt = lead.sqlAt ?? today();
      patch.leadStage = "sql";
    }
    await tx.update(contacts).set(patch).where(eq(contacts.id, id));
    await recordEvent(tx, {
      entityType: "contact",
      entityId: id,
      orgId: lead.orgId,
      actorId,
      action: "lead_status_changed",
      data: {
        from: lead.leadStatus ? (LEAD_STATUS_LABEL[lead.leadStatus as LeadStatus] ?? lead.leadStatus) : null,
        to: LEAD_STATUS_LABEL[status],
      },
    });

    const stageKey = dealStageForLead(status);
    if (!stageKey || !lead.orgId) return { ok: true };

    const [open] = await tx
      .select({ id: deals.id })
      .from(deals)
      .where(and(eq(deals.orgId, lead.orgId), eq(deals.status, "open")));
    if (open) return { ok: true, dealId: open.id, dealCreated: false };

    const [stage] = await tx
      .select()
      .from(stages)
      .where(and(eq(stages.pipeline, "sales"), eq(stages.key, stageKey)));
    const [org] = await tx.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, lead.orgId));
    const title = `${org.name} - ${lead.productInterest.join(" + ")}`;
    const [deal] = await tx
      .insert(deals)
      .values({
        orgId: lead.orgId,
        primaryContactId: lead.id,
        title,
        type: "new_business",
        stageId: stage.id,
        ownerId: lead.ownerId,
        sdrId: lead.sdrId,
        source: lead.source,
        partnerName: lead.partnerName,
        products: lead.productInterest,
      })
      .returning({ id: deals.id });
    await recordEvent(tx, {
      entityType: "deal",
      entityId: deal.id,
      orgId: lead.orgId,
      actorId,
      action: "created",
      data: { title, fromLead: lead.name, stage: stage.name },
    });
    await recomputeOrg(tx, lead.orgId);
    return { ok: true, dealId: deal.id, dealCreated: true };
  });
}
