/** Nurture list ("Reconnect"): companies with a get-back-in-touch date, and the daily task job. */
import { and, asc, eq, gte, isNotNull, isNull, like, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { activities, organizations, users } from "@/db/schema";
import { dueAtFromDay, istDay } from "@/domain/work";

/** Companies to reconnect with, soonest first. `ownerId` narrows to one AE's list. */
export async function listReconnects(ownerId?: string) {
  return db
    .select({
      id: organizations.id,
      name: organizations.name,
      lifecycle: organizations.lifecycle,
      website: organizations.website,
      reconnectOn: organizations.reconnectOn,
      reconnectReason: organizations.reconnectReason,
      aeId: organizations.aeId,
      aeName: users.name,
    })
    .from(organizations)
    .leftJoin(users, eq(users.id, organizations.aeId))
    .where(and(isNotNull(organizations.reconnectOn), ownerId ? eq(organizations.aeId, ownerId) : undefined))
    .orderBy(asc(organizations.reconnectOn), asc(organizations.name));
}

const TASK_PREFIX = "Reconnect with ";

/**
 * Daily: for each company whose reconnect day has come, open a task for its AE ("Reconnect with
 * Acme") once per reconnect date. It then shows in My work and the morning digest. After the call
 * the AE sets the next date or takes the company off the list. Companies without an AE stay on the
 * Reconnect list. Safe to re-run.
 */
export async function openReconnectTasks(now = new Date()) {
  const due = await db
    .select({ id: organizations.id, name: organizations.name, aeId: organizations.aeId, on: organizations.reconnectOn, reason: organizations.reconnectReason })
    .from(organizations)
    .where(and(isNotNull(organizations.reconnectOn), isNotNull(organizations.aeId), lte(organizations.reconnectOn, istDay(now))));
  let opened = 0;
  for (const org of due) {
    // One task per reconnect date: an open one, or one already done for this date, means skip.
    // Setting a new date starts a new cycle.
    const dueAt = dueAtFromDay(org.on!);
    const [existing] = await db
      .select({ id: activities.id })
      .from(activities)
      .where(and(eq(activities.orgId, org.id), like(activities.subject, `${TASK_PREFIX}%`), or(isNull(activities.completedAt), gte(activities.dueAt, dueAt))))
      .limit(1);
    if (existing) continue;
    await db.insert(activities).values({
      type: "task",
      subject: `${TASK_PREFIX}${org.name}`,
      body: org.reason ?? null,
      dueAt,
      ownerId: org.aeId,
      orgId: org.id,
    });
    opened++;
  }
  return { due: due.length, opened };
}

export const reconnectCounts = () =>
  db
    .select({ overdue: sql<number>`count(*) filter (where ${organizations.reconnectOn} < current_date)::int`, total: sql<number>`count(*)::int` })
    .from(organizations)
    .where(isNotNull(organizations.reconnectOn));
