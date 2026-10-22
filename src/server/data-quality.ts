/**
 * Data quality (Settings → Data quality): formatting that isn't standard yet, duplicate companies
 * and contacts, and merging them. Merges keep every deal, contact, activity and audit entry.
 */
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { activities, contacts, deals, events, notifications, onboardings, organizations } from "@/db/schema";
import { looseKey, normalizeEmail, normalizePhone, normalizeWebsite, tidyName } from "@/domain/fields";
import { recordEvent } from "./events";
import { recomputeOrg } from "./mrr";

// ---------- formatting ----------

type Fix = { table: "organizations" | "contacts"; id: string; field: "website" | "email" | "phone" | "name"; from: string; to: string };

/** Values that the save rules would change (websites to domains, emails to lower case, phones to E.164, names tidied). */
export async function formatFixes(): Promise<Fix[]> {
  const [orgs, people] = await Promise.all([
    db.select({ id: organizations.id, name: organizations.name, website: organizations.website }).from(organizations),
    db.select({ id: contacts.id, name: contacts.name, email: contacts.email, phone: contacts.phone }).from(contacts),
  ]);
  const fixes: Fix[] = [];
  for (const o of orgs) {
    const w = o.website && normalizeWebsite(o.website);
    if (o.website && w && w !== o.website) fixes.push({ table: "organizations", id: o.id, field: "website", from: o.website, to: w });
    if (tidyName(o.name) !== o.name) fixes.push({ table: "organizations", id: o.id, field: "name", from: o.name, to: tidyName(o.name) });
  }
  for (const c of people) {
    const e = c.email && normalizeEmail(c.email);
    if (c.email && e && e !== c.email) fixes.push({ table: "contacts", id: c.id, field: "email", from: c.email, to: e });
    const p = c.phone && normalizePhone(c.phone);
    if (c.phone && p && p !== c.phone) fixes.push({ table: "contacts", id: c.id, field: "phone", from: c.phone, to: p });
    if (tidyName(c.name) !== c.name) fixes.push({ table: "contacts", id: c.id, field: "name", from: c.name, to: tidyName(c.name) });
  }
  return fixes;
}

/** Apply every formatting fix. One audit entry per record type, not one per row. */
export async function applyFormatFixes(actorId: string) {
  const fixes = await formatFixes();
  await db.transaction(async (tx) => {
    for (const f of fixes) {
      const table = f.table === "organizations" ? organizations : contacts;
      await tx
        .update(table)
        .set({ [f.field]: f.to })
        .where(eq(table.id, f.id));
    }
    if (fixes.length) {
      await tx
        .insert(events)
        .values({ entityType: "data_quality", entityId: actorId, orgId: null, actorId, action: "formats_tidied", data: { count: fixes.length } });
    }
  });
  return fixes.length;
}

// ---------- duplicates ----------

export type DuplicateGroup<T> = { reason: string; records: T[] };

export async function duplicateCompanies() {
  const rows = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      website: organizations.website,
      lifecycle: organizations.lifecycle,
      contractedMrr: organizations.contractedMrr,
      deals: sql<number>`(select count(*)::int from ${deals} d where d.org_id = ${organizations.id})`,
      contacts: sql<number>`(select count(*)::int from ${contacts} c where c.org_id = ${organizations.id})`,
    })
    .from(organizations);
  type Row = (typeof rows)[number];
  const groups: DuplicateGroup<Row>[] = [];
  const seen = new Set<string>();
  const add = (reason: string, by: (r: Row) => string | null) => {
    const map = new Map<string, Row[]>();
    for (const r of rows) {
      const k = by(r);
      if (k) map.set(k, [...(map.get(k) ?? []), r]);
    }
    for (const [, list] of map) {
      const ids = list
        .map((r) => r.id)
        .sort()
        .join();
      if (list.length > 1 && !seen.has(ids)) {
        seen.add(ids);
        // Biggest first: it's usually the one to keep.
        groups.push({ reason, records: list.sort((a, b) => b.contractedMrr - a.contractedMrr || b.deals - a.deals) });
      }
    }
  };
  add("Same website", (r) => (r.website ? (normalizeWebsite(r.website) ?? r.website.toLowerCase()) : null));
  // "Acme", "ACME" and "Acme." are one company; legal suffixes are ignored too.
  add("Same name", (r) => looseKey(r.name.replace(/\b(pvt|private|ltd|limited|llp|inc|technologies|tech)\b\.?/gi, "")) || null);
  return groups;
}

export async function duplicateContacts() {
  const rows = await db
    .select({
      id: contacts.id,
      name: contacts.name,
      email: contacts.email,
      orgName: organizations.name,
      leadStatus: contacts.leadStatus,
      updatedAt: contacts.updatedAt,
    })
    .from(contacts)
    .leftJoin(organizations, eq(organizations.id, contacts.orgId))
    .where(isNotNull(contacts.email));
  const map = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = r.email!.trim().toLowerCase();
    map.set(k, [...(map.get(k) ?? []), r]);
  }
  return [...map.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([email, list]) => ({ reason: `Same email (${email})`, records: list.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()) }));
}

// ---------- merging ----------

const LIFECYCLE_RANK = { active: 5, onboarding: 4, on_hold: 3, churned: 2, prospect: 1 } as const;

export type MergeResult = { ok: true; message: string } | { ok: false; message: string };

/**
 * Merge company `dropId` into `keepId`: deals, contacts, activities, onboardings, audit entries and
 * notifications move over; empty fields on the kept company are filled from the other; LC account
 * IDs are combined; the more advanced lifecycle wins. The other company is then deleted.
 */
export async function mergeCompanies(keepId: string, dropId: string, actorId: string): Promise<MergeResult> {
  if (keepId === dropId) return { ok: false, message: "Pick two different companies" };
  return db.transaction(async (tx) => {
    const [keep] = await tx.select().from(organizations).where(eq(organizations.id, keepId));
    const [drop] = await tx.select().from(organizations).where(eq(organizations.id, dropId));
    if (!keep || !drop) return { ok: false as const, message: "Company not found" };
    const openOnb = await tx
      .select({ orgId: onboardings.orgId })
      .from(onboardings)
      .where(and(isNull(onboardings.completedAt), sql`${onboardings.orgId} in (${keepId}, ${dropId})`));
    if (openOnb.length > 1) return { ok: false as const, message: "Both companies have an onboarding in progress. Finish or close one first." };

    await tx.update(deals).set({ orgId: keepId }).where(eq(deals.orgId, dropId));
    await tx.update(contacts).set({ orgId: keepId }).where(eq(contacts.orgId, dropId));
    await tx.update(activities).set({ orgId: keepId }).where(eq(activities.orgId, dropId));
    await tx.update(onboardings).set({ orgId: keepId }).where(eq(onboardings.orgId, dropId));
    await tx.update(events).set({ orgId: keepId }).where(eq(events.orgId, dropId));
    await tx.update(notifications).set({ orgId: keepId }).where(eq(notifications.orgId, dropId));

    const fill = <K extends keyof typeof keep>(k: K) => (keep[k] ?? drop[k]) as (typeof keep)[K];
    await tx
      .update(organizations)
      .set({
        website: fill("website"),
        segment: fill("segment"),
        industry: fill("industry"),
        websiteTrafficRange: fill("websiteTrafficRange"),
        hqCity: fill("hqCity"),
        aeId: fill("aeId"),
        omId: fill("omId"),
        csmId: fill("csmId"),
        chargebeeCustomerId: fill("chargebeeCustomerId"),
        clientChannel: fill("clientChannel"),
        health: fill("health"),
        healthNote: fill("healthNote"),
        salesmateCompanyId: fill("salesmateCompanyId"),
        reconnectOn: fill("reconnectOn"),
        reconnectReason: fill("reconnectReason"),
        lcAccountIds: [...new Set([...keep.lcAccountIds, ...drop.lcAccountIds])],
        lifecycle: LIFECYCLE_RANK[drop.lifecycle] > LIFECYCLE_RANK[keep.lifecycle] ? drop.lifecycle : keep.lifecycle,
      })
      .where(eq(organizations.id, keepId));
    await tx.delete(organizations).where(eq(organizations.id, dropId));
    await recordEvent(tx, {
      entityType: "organization",
      entityId: keepId,
      orgId: keepId,
      actorId,
      action: "merged",
      data: { from: drop.name, fromId: drop.id },
    });
    await recomputeOrg(tx, keepId);
    return { ok: true as const, message: `Merged ${drop.name} into ${keep.name}` };
  });
}

/** Merge contact `dropId` into `keepId`: activities and deal links move over, empty fields are filled. */
export async function mergeContacts(keepId: string, dropId: string, actorId: string): Promise<MergeResult> {
  if (keepId === dropId) return { ok: false, message: "Pick two different people" };
  return db.transaction(async (tx) => {
    const [keep] = await tx.select().from(contacts).where(eq(contacts.id, keepId));
    const [drop] = await tx.select().from(contacts).where(eq(contacts.id, dropId));
    if (!keep || !drop) return { ok: false as const, message: "Contact not found" };
    await tx.update(activities).set({ contactId: keepId }).where(eq(activities.contactId, dropId));
    await tx.update(deals).set({ primaryContactId: keepId }).where(eq(deals.primaryContactId, dropId));
    const patch: Partial<typeof contacts.$inferInsert> = {};
    for (const k of Object.keys(drop) as (keyof typeof drop)[]) {
      if (["id", "createdAt", "updatedAt"].includes(k)) continue;
      const empty = keep[k] === null || (Array.isArray(keep[k]) && (keep[k] as unknown[]).length === 0);
      if (empty && drop[k] !== null) (patch as Record<string, unknown>)[k] = drop[k];
    }
    if (Object.keys(patch).length) await tx.update(contacts).set(patch).where(eq(contacts.id, keepId));
    await tx.delete(contacts).where(eq(contacts.id, dropId));
    await recordEvent(tx, {
      entityType: "contact",
      entityId: keepId,
      orgId: keep.orgId ?? drop.orgId,
      actorId,
      action: "merged",
      data: { from: drop.name, fromId: drop.id },
    });
    return { ok: true as const, message: `Merged ${drop.name} into ${keep.name}` };
  });
}
