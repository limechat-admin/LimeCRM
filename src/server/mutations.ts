import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { activities, savedViews, dealLineItems, deals, onboardings, organizations, stages } from "@/db/schema";
import { diff, recordEvent } from "./events";
import { recomputeDeal, recomputeOrg } from "./mrr";

type DealPatch = Partial<
  Pick<
    typeof deals.$inferInsert,
    | "title"
    | "type"
    | "ownerId"
    | "sdrId"
    | "primaryContactId"
    | "source"
    | "partnerName"
    | "plan"
    | "products"
    | "priority"
    | "expectedCloseDate"
    | "billingCycle"
    | "currency"
    | "contractStart"
    | "contractRenewal"
    | "contractLink"
    | "requiresOnboarding"
    | "lostReason"
    | "lostDetail"
  >
>;

export async function updateDeal(id: string, patch: DealPatch, actorId: string) {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(deals).where(eq(deals.id, id));
    const changes = diff(before, patch);
    if (!Object.keys(changes).length) return;
    await tx.update(deals).set(patch).where(eq(deals.id, id));
    await recordEvent(tx, { entityType: "deal", entityId: id, orgId: before.orgId, actorId, action: "updated", data: changes });
  });
}

type OrgPatch = Partial<
  Pick<
    typeof organizations.$inferInsert,
    "name" | "website" | "segment" | "industry" | "hqCity" | "aeId" | "omId" | "csmId" | "lcAccountIds" | "chargebeeCustomerId" | "clientChannel" | "health" | "healthNote" | "reconnectOn" | "reconnectReason"
  >
>;

export async function updateOrganization(id: string, patch: OrgPatch, actorId: string) {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(organizations).where(eq(organizations.id, id));
    const changes = diff(before, patch);
    if (!Object.keys(changes).length) return;
    await tx.update(organizations).set(patch).where(eq(organizations.id, id));
    await recordEvent(tx, { entityType: "organization", entityId: id, orgId: id, actorId, action: "updated", data: changes });
  });
}

type OnboardingPatch = Partial<
  Pick<typeof onboardings.$inferInsert, "omId" | "kickoffDate" | "goLiveDate" | "health" | "nps" | "voiceAdoption" | "notes">
>;

export async function updateOnboarding(id: string, patch: OnboardingPatch, actorId: string) {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(onboardings).where(eq(onboardings.id, id));
    const changes = diff(before, patch);
    if (!Object.keys(changes).length) return;
    await tx.update(onboardings).set(patch).where(eq(onboardings.id, id));
    await recordEvent(tx, { entityType: "onboarding", entityId: id, orgId: before.orgId, actorId, action: "updated", data: changes });
  });
}

export async function addLineItem(dealId: string, item: Omit<typeof dealLineItems.$inferInsert, "dealId">, actorId: string) {
  return db.transaction(async (tx) => {
    const [{ next }] = await tx
      .select({ next: sql<number>`coalesce(max(${dealLineItems.position}), -1)::int + 1` })
      .from(dealLineItems)
      .where(eq(dealLineItems.dealId, dealId));
    await tx.insert(dealLineItems).values({ ...item, dealId, position: next });
    const totals = await recomputeDeal(tx, dealId);
    const [deal] = await tx.select({ orgId: deals.orgId }).from(deals).where(eq(deals.id, dealId));
    await recordEvent(tx, { entityType: "deal", entityId: dealId, orgId: deal.orgId, actorId, action: "line_item_added", data: { item, ...totals } });
  });
}

export async function removeLineItem(dealId: string, itemId: string, actorId: string) {
  return db.transaction(async (tx) => {
    const [removed] = await tx
      .delete(dealLineItems)
      .where(and(eq(dealLineItems.id, itemId), eq(dealLineItems.dealId, dealId)))
      .returning();
    if (!removed) return;
    const totals = await recomputeDeal(tx, dealId);
    const [deal] = await tx.select({ orgId: deals.orgId }).from(deals).where(eq(deals.id, dealId));
    await recordEvent(tx, {
      entityType: "deal",
      entityId: dealId,
      orgId: deal.orgId,
      actorId,
      action: "line_item_removed",
      data: { item: { kind: removed.kind, unitPrice: removed.unitPrice, quantity: removed.quantity }, ...totals },
    });
  });
}

export async function createDeal(
  input: { orgId: string; title: string; type: (typeof deals.$inferInsert)["type"]; ownerId: string | null },
  actorId: string,
) {
  return db.transaction(async (tx) => {
    const [first] = await tx
      .select()
      .from(stages)
      .where(and(eq(stages.pipeline, "sales"), eq(stages.position, 1)));
    const [deal] = await tx.insert(deals).values({ ...input, stageId: first.id }).returning();
    await recordEvent(tx, { entityType: "deal", entityId: deal.id, orgId: input.orgId, actorId, action: "created", data: { title: input.title } });
    await recomputeOrg(tx, input.orgId);
    return deal;
  });
}

export async function createOrganization(input: { name: string; website: string | null; aeId: string | null }, actorId: string) {
  return db.transaction(async (tx) => {
    const [org] = await tx.insert(organizations).values(input).returning();
    await recordEvent(tx, { entityType: "organization", entityId: org.id, orgId: org.id, actorId, action: "created", data: { name: org.name } });
    return org;
  });
}

export async function logActivity(input: Omit<typeof activities.$inferInsert, "createdById">, actorId: string) {
  await db.insert(activities).values({ ...input, createdById: actorId });
}

/** Mark an open task done. Returns false when it doesn't exist or was already completed. */
export async function completeTask(id: string) {
  const done = await db
    .update(activities)
    .set({ completedAt: new Date() })
    .where(and(eq(activities.id, id), isNull(activities.completedAt)))
    .returning({ id: activities.id });
  return done.length > 0;
}

export async function createView(input: { ownerId: string; module: string; name: string; query: string; shared: boolean }) {
  const [view] = await db.insert(savedViews).values(input).returning();
  return view;
}

/** Delete a view; only its owner (or an admin) may. Returns false when not allowed or not found. */
export async function deleteView(id: string, user: { id: string; role: string }) {
  const where = user.role === "admin" ? eq(savedViews.id, id) : and(eq(savedViews.id, id), eq(savedViews.ownerId, user.id));
  const gone = await db.delete(savedViews).where(where).returning({ id: savedViews.id });
  return gone.length > 0;
}
