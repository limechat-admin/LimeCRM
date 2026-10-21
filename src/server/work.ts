import "server-only";
import { and, asc, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { activities, contacts, deals, organizations, stages, users } from "@/db/schema";
import { bucketTasks, daysSince, isStale } from "@/domain/work";

/** Open tasks (activities with no completion) for one person, or everyone. */
async function openTasks(ownerId: string | null) {
  const owner = alias(users, "owner");
  return db
    .select({
      id: activities.id,
      type: activities.type,
      subject: activities.subject,
      body: activities.body,
      dueAt: activities.dueAt,
      orgId: activities.orgId,
      orgName: organizations.name,
      dealId: activities.dealId,
      dealTitle: deals.title,
      contactId: activities.contactId,
      contactName: contacts.name,
      ownerName: owner.name,
    })
    .from(activities)
    .leftJoin(organizations, eq(organizations.id, activities.orgId))
    .leftJoin(deals, eq(deals.id, activities.dealId))
    .leftJoin(contacts, eq(contacts.id, activities.contactId))
    .leftJoin(owner, eq(owner.id, activities.ownerId))
    .where(and(isNull(activities.completedAt), ownerId ? eq(activities.ownerId, ownerId) : undefined))
    .orderBy(asc(activities.dueAt))
    .limit(500);
}

/**
 * Open deals with their last touch: the latest of an activity on the deal, an event on the deal
 * (stage moves, edits, pricing) and the deal row itself.
 */
async function openDealsWithLastTouch(ownerId: string | null) {
  const owner = alias(users, "owner");
  const lastActivity = sql<Date | null>`(select max(a.created_at) from activities a where a.deal_id = ${deals.id})`;
  const lastEvent = sql<Date | null>`(select max(e.created_at) from events e where e.entity_type = 'deal' and e.entity_id = ${deals.id})`;
  const rows = await db
    .select({
      id: deals.id,
      title: deals.title,
      mrr: deals.mrr,
      stageName: stages.name,
      orgId: organizations.id,
      orgName: organizations.name,
      ownerName: owner.name,
      lastTouch: sql<string | null>`greatest(${lastActivity}, ${lastEvent}, ${deals.updatedAt})`,
    })
    .from(deals)
    .innerJoin(stages, eq(stages.id, deals.stageId))
    .innerJoin(organizations, eq(organizations.id, deals.orgId))
    .leftJoin(owner, eq(owner.id, deals.ownerId))
    .where(and(eq(deals.status, "open"), ownerId ? eq(deals.ownerId, ownerId) : undefined));
  // greatest() over subqueries comes back as a string from postgres-js
  return rows.map((r) => ({ ...r, lastTouch: r.lastTouch ? new Date(r.lastTouch) : null }));
}

export async function getMyWork(ownerId: string | null, now = new Date()) {
  const [tasks, openDeals] = await Promise.all([openTasks(ownerId), openDealsWithLastTouch(ownerId)]);
  const stale = openDeals
    .filter((d) => isStale(d.lastTouch, now))
    .map((d) => ({ ...d, idleDays: daysSince(d.lastTouch, now) }))
    .sort((a, b) => (b.idleDays ?? Infinity) - (a.idleDays ?? Infinity));
  return { tasks: bucketTasks(tasks, now), stale, openDealCount: openDeals.length };
}

export type MyWork = Awaited<ReturnType<typeof getMyWork>>;

const SEARCH_LIMIT = 8;

/** Header search: companies, deals and leads/contacts matching the text. */
export async function searchAll(q: string) {
  const like = `%${q.trim()}%`;
  const [orgs, dealRows, people] = await Promise.all([
    db
      .select({ id: organizations.id, name: organizations.name, lifecycle: organizations.lifecycle, mrr: organizations.contractedMrr, website: organizations.website })
      .from(organizations)
      .where(or(ilike(organizations.name, like), ilike(organizations.website, like)))
      .orderBy(desc(organizations.contractedMrr), asc(organizations.name))
      .limit(SEARCH_LIMIT),
    db
      .select({ id: deals.id, title: deals.title, status: deals.status, mrr: deals.mrr, stageName: stages.name, orgName: organizations.name })
      .from(deals)
      .innerJoin(stages, eq(stages.id, deals.stageId))
      .innerJoin(organizations, eq(organizations.id, deals.orgId))
      .where(or(ilike(deals.title, like), ilike(organizations.name, like)))
      .orderBy(desc(deals.updatedAt))
      .limit(SEARCH_LIMIT),
    db
      .select({
        id: contacts.id,
        name: contacts.name,
        email: contacts.email,
        designation: contacts.designation,
        leadStatus: contacts.leadStatus,
        orgName: organizations.name,
      })
      .from(contacts)
      .leftJoin(organizations, eq(organizations.id, contacts.orgId))
      .where(or(ilike(contacts.name, like), ilike(contacts.email, like), ilike(contacts.phone, like)))
      .orderBy(desc(contacts.updatedAt))
      .limit(SEARCH_LIMIT),
  ]);
  return { orgs, deals: dealRows, people };
}
