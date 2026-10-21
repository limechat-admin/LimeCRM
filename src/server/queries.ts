import "server-only";
import { and, asc, count, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  activities,
  contacts,
  dealLineItems,
  deals,
  events,
  lifecycle,
  onboardings,
  organizations,
  savedViews,
  stages,
  users,
} from "@/db/schema";
import { missingFields, requiredFieldsFor } from "@/domain/gates";
import { isUuid } from "@/lib/ids";

export const listUsers = () => db.select().from(users).where(eq(users.isActive, true)).orderBy(asc(users.name));

export const listStages = (pipeline: "sales" | "onboarding") =>
  db.select().from(stages).where(eq(stages.pipeline, pipeline)).orderBy(asc(stages.position));

export async function getDealBoard() {
  const [stageRows, rows] = await Promise.all([
    listStages("sales"),
    db
      .select({
        id: deals.id,
        title: deals.title,
        stageId: deals.stageId,
        mrr: deals.mrr,
        expectedCloseDate: deals.expectedCloseDate,
        priority: deals.priority,
        orgId: organizations.id,
        orgName: organizations.name,
        ownerName: users.name,
      })
      .from(deals)
      .innerJoin(organizations, eq(organizations.id, deals.orgId))
      .leftJoin(users, eq(users.id, deals.ownerId))
      .where(isNull(deals.endedAt))
      .orderBy(desc(deals.mrr)),
  ]);
  return stageRows.map((s) => {
    const items = rows.filter((r) => r.stageId === s.id);
    return { stage: s, deals: items, total: items.reduce((a, d) => a + d.mrr, 0) };
  });
}

export async function getDeal(id: string) {
  if (!isUuid(id)) return null;
  const [deal] = await db.select().from(deals).where(eq(deals.id, id));
  if (!deal) return null;
  const [[org], lineItems, salesStages, orgContacts] = await Promise.all([
    db.select().from(organizations).where(eq(organizations.id, deal.orgId)),
    db.select().from(dealLineItems).where(eq(dealLineItems.dealId, id)).orderBy(asc(dealLineItems.position), asc(dealLineItems.createdAt)),
    listStages("sales"),
    db.select().from(contacts).where(eq(contacts.orgId, deal.orgId)).orderBy(asc(contacts.name)),
  ]);
  const current = salesStages.find((s) => s.id === deal.stageId)!;
  // What each stage would still need — drives the "what's missing" hints next to each move button.
  const gates = salesStages.map((s) => ({
    stage: s,
    missing: s.id === deal.stageId ? [] : missingFields({ deal, lineItems, org }, requiredFieldsFor(salesStages, s)),
  }));
  return { deal, org, lineItems, stages: salesStages, current, gates, contacts: orgContacts };
}

export type OrgFilters = { q?: string; lifecycle?: string; aeId?: string };

/**
 * Companies, biggest contracted MRR first. With filters (search, lifecycle, AE or "none") for the
 * list; without, every company (CSV export). `limit` caps the rows; `total` is the full match count.
 */
export async function listOrganizations(f: OrgFilters = {}, limit?: number) {
  const ae = alias(users, "ae");
  const csm = alias(users, "csm");
  const conds: SQL[] = [];
  if (f.q?.trim()) {
    const like = `%${f.q.trim()}%`;
    conds.push(or(ilike(organizations.name, like), ilike(organizations.website, like))!);
  }
  if (f.lifecycle && (lifecycle.enumValues as readonly string[]).includes(f.lifecycle)) {
    conds.push(eq(organizations.lifecycle, f.lifecycle as (typeof lifecycle.enumValues)[number]));
  }
  if (f.aeId === "none") conds.push(isNull(organizations.aeId));
  else if (f.aeId && isUuid(f.aeId)) conds.push(eq(organizations.aeId, f.aeId));
  const where = conds.length ? and(...conds) : undefined;
  const query = db
    .select({
      id: organizations.id,
      name: organizations.name,
      lifecycle: organizations.lifecycle,
      segment: organizations.segment,
      contractedMrr: organizations.contractedMrr,
      hqCity: organizations.hqCity,
      lcAccountIds: organizations.lcAccountIds,
      aeName: ae.name,
      csmName: csm.name,
    })
    .from(organizations)
    .leftJoin(ae, eq(ae.id, organizations.aeId))
    .leftJoin(csm, eq(csm.id, organizations.csmId))
    .where(where)
    .orderBy(desc(organizations.contractedMrr), asc(organizations.name));
  const rows = limit ? await query.limit(limit) : await query;
  const [{ n }] = await db.select({ n: count() }).from(organizations).where(where);
  return Object.assign(rows, { total: n });
}

export async function getOrganization(id: string) {
  if (!isUuid(id)) return null;
  const [org] = await db.select().from(organizations).where(eq(organizations.id, id));
  if (!org) return null;
  const [orgDeals, orgContacts, orgOnboardings, onboardingStages] = await Promise.all([
    db
      .select({ deal: deals, stageName: stages.name, stageKind: stages.kind })
      .from(deals)
      .innerJoin(stages, eq(stages.id, deals.stageId))
      .where(eq(deals.orgId, id))
      .orderBy(desc(deals.createdAt)),
    db.select().from(contacts).where(eq(contacts.orgId, id)).orderBy(asc(contacts.name)),
    db.select().from(onboardings).where(eq(onboardings.orgId, id)).orderBy(desc(onboardings.createdAt)),
    listStages("onboarding"),
  ]);
  const openOnboarding = orgOnboardings.find((o) => !o.completedAt) ?? null;
  const onboardingGates = openOnboarding
    ? onboardingStages.map((s) => ({
        stage: s,
        missing:
          s.id === openOnboarding.stageId
            ? []
            : missingFields({ org, onboarding: openOnboarding }, requiredFieldsFor(onboardingStages, s)),
      }))
    : [];
  return { org, deals: orgDeals, contacts: orgContacts, onboardings: orgOnboardings, openOnboarding, onboardingStages, onboardingGates };
}

export async function getOnboardingBoard() {
  const om = alias(users, "om");
  const [stageRows, rows] = await Promise.all([
    listStages("onboarding"),
    db
      .select({
        id: onboardings.id,
        stageId: onboardings.stageId,
        kickoffDate: onboardings.kickoffDate,
        health: onboardings.health,
        orgId: organizations.id,
        orgName: organizations.name,
        mrr: organizations.contractedMrr,
        omName: om.name,
      })
      .from(onboardings)
      .innerJoin(organizations, eq(organizations.id, onboardings.orgId))
      .leftJoin(om, eq(om.id, onboardings.omId))
      .where(isNull(onboardings.completedAt)),
  ]);
  return stageRows.map((s) => ({ stage: s, items: rows.filter((r) => r.stageId === s.id) }));
}

/** Unified timeline for an organization or a single deal: audit events plus activities, newest first. */
type TimelineScope = { orgId: string } | { dealId: string; orgId: string } | { contactId: string };

export async function getTimeline(scope: TimelineScope) {
  const eventWhere =
    "dealId" in scope
      ? and(eq(events.entityType, "deal"), eq(events.entityId, scope.dealId))
      : "contactId" in scope
        ? and(eq(events.entityType, "contact"), eq(events.entityId, scope.contactId))
        : eq(events.orgId, scope.orgId);
  const activityWhere =
    "dealId" in scope
      ? eq(activities.dealId, scope.dealId)
      : "contactId" in scope
        ? eq(activities.contactId, scope.contactId)
        : eq(activities.orgId, scope.orgId);
  const [ev, acts] = await Promise.all([
    db
      .select({ e: events, actor: users.name })
      .from(events)
      .leftJoin(users, eq(users.id, events.actorId))
      .where(eventWhere)
      .orderBy(desc(events.id))
      .limit(100),
    db
      .select({ a: activities, owner: users.name })
      .from(activities)
      .leftJoin(users, eq(users.id, activities.ownerId))
      .where(activityWhere)
      .orderBy(desc(activities.createdAt))
      .limit(100),
  ]);
  return [
    ...ev.map(({ e, actor }) => ({ kind: "event" as const, at: e.createdAt, actor, e })),
    ...acts.map(({ a, owner }) => ({ kind: "activity" as const, at: a.createdAt, actor: owner, a })),
  ].sort((x, y) => y.at.getTime() - x.at.getTime());
}

export type LeadFilters = { q?: string; status?: string; ownerId?: string; sdrId?: string };

const LEAD_PAGE_SIZE = 100;

/** Leads (contacts with a lead status), newest activity first, with per-status counts for the filters. */
export async function listLeads(f: LeadFilters, limit = LEAD_PAGE_SIZE) {
  const owner = alias(users, "owner");
  const sdr = alias(users, "sdr");
  const conds: SQL[] = [];
  if (f.q) {
    const like = `%${f.q.trim()}%`;
    conds.push(or(ilike(contacts.name, like), ilike(contacts.email, like), ilike(organizations.name, like))!);
  }
  if (f.ownerId) conds.push(eq(contacts.ownerId, f.ownerId));
  if (f.sdrId) conds.push(eq(contacts.sdrId, f.sdrId));
  const base = conds.length ? and(...conds) : undefined;
  const where = !f.status ? base : and(base, f.status === "none" ? isNull(contacts.leadStatus) : eq(contacts.leadStatus, f.status));

  const [rows, byStatus] = await Promise.all([
    db
      .select({ c: contacts, orgName: organizations.name, ownerName: owner.name, sdrName: sdr.name })
      .from(contacts)
      .leftJoin(organizations, eq(organizations.id, contacts.orgId))
      .leftJoin(owner, eq(owner.id, contacts.ownerId))
      .leftJoin(sdr, eq(sdr.id, contacts.sdrId))
      .where(where)
      .orderBy(desc(contacts.updatedAt))
      .limit(limit),
    db
      .select({ status: contacts.leadStatus, n: count() })
      .from(contacts)
      .leftJoin(organizations, eq(organizations.id, contacts.orgId))
      .where(base)
      .groupBy(contacts.leadStatus),
  ]);
  return { rows, byStatus: Object.fromEntries(byStatus.map((r) => [r.status ?? "none", r.n])), pageSize: LEAD_PAGE_SIZE };
}

export async function getLead(id: string) {
  if (!isUuid(id)) return null;
  const [lead] = await db.select().from(contacts).where(eq(contacts.id, id));
  if (!lead) return null;
  const [org] = lead.orgId ? await db.select().from(organizations).where(eq(organizations.id, lead.orgId)) : [null];
  const orgDeals = lead.orgId
    ? await db
        .select({ id: deals.id, title: deals.title, status: deals.status, mrr: deals.mrr, stageName: stages.name })
        .from(deals)
        .innerJoin(stages, eq(stages.id, deals.stageId))
        .where(eq(deals.orgId, lead.orgId))
        .orderBy(desc(deals.createdAt))
    : [];
  return { lead, org, deals: orgDeals };
}

/** Saved views a user can use on a list: their own plus everyone's shared ones. */
export async function listViews(module: string, userId: string) {
  return db
    .select({ id: savedViews.id, name: savedViews.name, query: savedViews.query, shared: savedViews.shared, ownerId: savedViews.ownerId, ownerName: users.name })
    .from(savedViews)
    .innerJoin(users, eq(users.id, savedViews.ownerId))
    .where(and(eq(savedViews.module, module), or(eq(savedViews.ownerId, userId), eq(savedViews.shared, true))))
    .orderBy(asc(savedViews.name));
}

/** Name for the browser tab of a record page. */
export async function recordTitle(kind: "deal" | "organization" | "lead", id: string): Promise<string | null> {
  if (!isUuid(id)) return null;
  if (kind === "deal") return (await db.select({ t: deals.title }).from(deals).where(eq(deals.id, id)))[0]?.t ?? null;
  if (kind === "organization") return (await db.select({ t: organizations.name }).from(organizations).where(eq(organizations.id, id)))[0]?.t ?? null;
  return (await db.select({ t: contacts.name }).from(contacts).where(eq(contacts.id, id)))[0]?.t ?? null;
}

/** Companies per lifecycle and the contracted MRR of current customers, for the Companies page tiles. */
export async function organizationSummary() {
  const rows = await db
    .select({ lifecycle: organizations.lifecycle, n: count(), mrr: sql<number>`coalesce(sum(${organizations.contractedMrr}), 0)::float` })
    .from(organizations)
    .groupBy(organizations.lifecycle);
  const by = (l: string) => rows.find((r) => r.lifecycle === l) ?? { n: 0, mrr: 0 };
  const customerKinds = ["onboarding", "active", "on_hold"];
  return {
    customers: customerKinds.reduce((a, l) => a + by(l).n, 0),
    bookMrr: customerKinds.reduce((a, l) => a + Number(by(l).mrr), 0),
    active: by("active").n,
    prospects: by("prospect").n,
  };
}
