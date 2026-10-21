/**
 * Load a transform plan into the LOCAL dev database and print the reconciliation report.
 *
 *   pnpm migrate:load --dry-run     # load inside a transaction, report, then roll back
 *   pnpm migrate:load               # commit
 *   pnpm migrate:load --replace     # first delete rows from a previous Salesmate import
 *   pnpm migrate:load --purge       # only delete a previous import
 *   [--snapshot data/salesmate/<ts>]
 *
 * Refuses any DATABASE_URL that isn't on localhost. Imported rows are marked by a
 * `created` event with data.via = "salesmate_import", which is how --replace finds them.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { activities, contacts, dealLineItems, deals, events, onboardings, organizations, stages, users } from "@/db/schema";
import { ALL_STAGES } from "@/domain/stage-config";
import { recomputeOrg } from "@/server/mrr";
import { parseArgs, readJson, resolveSnapshot, writeText } from "./lib/util";
import type { Plan } from "./plan";
import { reconciliationMarkdown, type ActiveOrgRow } from "./report";

const VIA = "salesmate_import";

class DryRunRollback extends Error {}

function assertLocalDatabase() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) {
    throw new Error(`Refusing to load into ${host}: this loader only targets the local dev database.`);
  }
  return url.replace(/:[^:@/]+@/, ":***@");
}

async function chunked<T>(rows: T[], size: number, fn: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}

const ts = (s: string | null) => (s ? new Date(s) : null);

async function deletePreviousImport(tx: Tx) {
  const imported = await tx
    .select({ entityType: events.entityType, entityId: events.entityId })
    .from(events)
    .where(and(eq(events.action, "created"), sql`${events.data}->>'via' = ${VIA}`));
  const ids = (t: string) => imported.filter((e) => e.entityType === t).map((e) => e.entityId);
  const orgIds = ids("organization");
  if (!orgIds.length) return 0;
  // Activities, onboardings, deals and contacts of imported orgs, then the orgs themselves.
  await chunked(orgIds, 1000, async (c) => {
    await tx.delete(activities).where(inArray(activities.orgId, c));
    await tx.delete(events).where(inArray(events.orgId, c));
    await tx.delete(onboardings).where(inArray(onboardings.orgId, c));
    await tx.delete(deals).where(inArray(deals.orgId, c));
    await tx.delete(contacts).where(inArray(contacts.orgId, c));
  });
  await chunked(ids("contact"), 1000, (c) => tx.delete(contacts).where(inArray(contacts.id, c)));
  await chunked(orgIds, 1000, (c) => tx.delete(organizations).where(inArray(organizations.id, c)));
  return orgIds.length;
}

async function load(tx: Tx, plan: Plan, replace: boolean) {
  if (replace) console.log(`replaced ${await deletePreviousImport(tx)} previously imported organizations`);
  else {
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(events)
      .where(and(eq(events.action, "created"), sql`${events.data}->>'via' = ${VIA}`));
    if (n > 0) throw new Error("This database already has a Salesmate import. Rerun with --replace (or --dry-run --replace).");
  }

  // Stages are config: make sure they exist (same upsert as the seed).
  for (const s of ALL_STAGES) {
    await tx
      .insert(stages)
      .values(s)
      .onConflictDoUpdate({ target: [stages.pipeline, stages.key], set: { name: s.name, position: s.position, kind: s.kind, winProbability: s.winProbability, requiredFields: s.requiredFields } });
  }
  const stageRows = await tx.select().from(stages);
  const stageId = (pipeline: "sales" | "onboarding", key: string) => {
    const s = stageRows.find((r) => r.pipeline === pipeline && r.key === key);
    if (!s) throw new Error(`Unknown ${pipeline} stage ${key}`);
    return s.id;
  };

  // Users: insert missing ones; never change existing users' role or name.
  if (plan.users.length) {
    await tx
      .insert(users)
      .values(plan.users.map((u) => ({ email: u.email, name: u.name, role: u.role, isActive: u.isActive })))
      .onConflictDoNothing({ target: users.email });
  }
  const userRows = await tx.select({ id: users.id, email: users.email }).from(users);
  const userId = new Map(userRows.map((u) => [u.email, u.id]));
  const uid = (email: string | null) => (email ? (userId.get(email) ?? null) : null);

  await chunked(plan.orgs, 500, (c) =>
    tx.insert(organizations).values(
      c.map((o) => ({
        id: o.id,
        name: o.name,
        website: o.website,
        websiteTrafficRange: o.websiteTrafficRange,
        segment: o.segment,
        industry: o.industry,
        hqCity: o.hqCity,
        lifecycle: o.lifecycle,
        aeId: uid(o.aeEmail),
        omId: uid(o.omEmail),
        csmId: uid(o.csmEmail),
        lcAccountIds: o.lcAccountIds,
        chargebeeCustomerId: o.chargebeeCustomerId,
        health: o.health,
        healthNote: o.healthNote,
        churnedAt: o.churnedAt,
        churnCategory: o.churnCategory,
        churnReason: o.churnReason,
        churnLastBillingDate: o.churnLastBillingDate,
        salesmateCompanyId: o.salesmateCompanyId,
        ...(o.createdAt ? { createdAt: new Date(o.createdAt) } : {}),
      })),
    ),
  );

  await chunked(plan.contacts, 1000, (c) =>
    tx.insert(contacts).values(
      c.map((x) => ({
        id: x.id,
        orgId: x.orgId,
        name: x.name,
        email: x.email,
        phone: x.phone,
        designation: x.designation,
        leadStatus: x.leadStatus,
        leadStage: x.leadStage,
        source: x.source,
        partnerName: x.partnerName,
        productInterest: x.productInterest,
        meetingScheduledAt: x.meetingScheduledAt,
        meetingCompletedAt: x.meetingCompletedAt,
        qualifiedAt: x.qualifiedAt,
        sqlAt: x.sqlAt,
        ownerId: uid(x.ownerEmail),
        salesmateContactId: x.salesmateContactId,
      })),
    ),
  );

  await chunked(plan.deals, 500, (c) =>
    tx.insert(deals).values(
      c.map((d) => ({
        id: d.id,
        orgId: d.orgId,
        primaryContactId: d.primaryContactId,
        title: d.title,
        type: d.type,
        stageId: stageId("sales", d.stageKey),
        status: d.status,
        ownerId: uid(d.ownerEmail),
        source: d.source,
        partnerName: d.partnerName,
        plan: d.plan,
        products: d.products,
        priority: d.priority,
        expectedCloseDate: d.expectedCloseDate,
        closedAt: ts(d.closedAt),
        endedAt: d.endedAt,
        lostReason: d.lostReason,
        lostDetail: d.lostDetail,
        billingCycle: d.billingCycle,
        currency: d.currency,
        contractStart: d.contractStart,
        contractRenewal: d.contractRenewal,
        contractLink: d.contractLink,
        requiresOnboarding: d.requiresOnboarding,
        // Same maths as src/server/mrr.ts#recomputeDeal (dealTotals over the line items below).
        mrr: d.mrr,
        oneTimeFee: d.oneTimeFee,
        salesmateDealIds: d.salesmateDealIds,
        ...(d.createdAt ? { createdAt: new Date(d.createdAt) } : {}),
        ...(d.modifiedAt ? { updatedAt: new Date(d.modifiedAt) } : {}),
      })),
    ),
  );
  const items = plan.deals.flatMap((d) => d.lineItems.map((i) => ({ ...i, dealId: d.id })));
  await chunked(items, 1000, (c) => tx.insert(dealLineItems).values(c));

  await chunked(plan.onboardings, 500, (c) =>
    tx.insert(onboardings).values(
      c.map((o) => ({
        id: o.id,
        orgId: o.orgId,
        dealId: o.dealId,
        stageId: stageId("onboarding", o.stageKey),
        omId: uid(o.omEmail),
        kickoffDate: o.kickoffDate,
        goLiveDate: o.goLiveDate,
        health: o.health,
        nps: o.nps,
        voiceAdoption: o.voiceAdoption,
        notes: o.notes,
        completedAt: ts(o.completedAt),
        ...(o.createdAt ? { createdAt: new Date(o.createdAt) } : {}),
      })),
    ),
  );

  await chunked(plan.activities, 1000, (c) =>
    tx.insert(activities).values(
      c.map((a) => ({
        id: a.id,
        type: a.type,
        subject: a.subject,
        body: a.body,
        orgId: a.orgId,
        dealId: a.dealId,
        contactId: a.contactId,
        ownerId: uid(a.ownerEmail),
        dueAt: ts(a.dueAt),
        completedAt: ts(a.completedAt),
        ...(a.createdAt ? { createdAt: new Date(a.createdAt) } : {}),
      })),
    ),
  );

  // Timeline + provenance. One `created` event per imported record (the --replace marker),
  // plus the stage the deal/onboarding reached, dated when Salesmate says it happened.
  const orgName = new Map(plan.orgs.map((o) => [o.id, o.name]));
  const ev = [
    ...plan.orgs.map((o) => ({ entityType: "organization", entityId: o.id, orgId: o.id, action: "created", data: { via: VIA, name: o.name, salesmateCompanyIds: o.salesmateCompanyIds, groups: o.groupKeys }, createdAt: ts(o.createdAt) })),
    ...plan.contacts.map((c) => ({ entityType: "contact", entityId: c.id, orgId: c.orgId, action: "created", data: { via: VIA, name: c.name, salesmateContactId: c.salesmateContactId }, createdAt: null })),
    ...plan.deals.map((d) => ({ entityType: "deal", entityId: d.id, orgId: d.orgId, action: "created", data: { via: VIA, title: d.title, salesmateDealIds: d.salesmateDealIds, confidence: d.confidence, mrrSource: d.mrrSource }, createdAt: ts(d.createdAt) })),
    ...plan.deals
      .filter((d) => d.closedAt)
      .map((d) => ({ entityType: "deal", entityId: d.id, orgId: d.orgId, action: "stage_changed", data: { via: VIA, to: stageRows.find((s) => s.pipeline === "sales" && s.key === d.stageKey)!.name }, createdAt: ts(d.closedAt) })),
    ...plan.onboardings.map((o) => ({ entityType: "onboarding", entityId: o.id, orgId: o.orgId, action: "created", data: { via: VIA, org: orgName.get(o.orgId), salesmateDealId: o.salesmateDealId }, createdAt: ts(o.createdAt) })),
    ...plan.onboardings
      .filter((o) => o.completedAt)
      .map((o) => ({ entityType: "onboarding", entityId: o.id, orgId: o.orgId, action: "stage_changed", data: { via: VIA, to: stageRows.find((s) => s.pipeline === "onboarding" && s.key === o.stageKey)!.name }, createdAt: ts(o.completedAt) })),
  ].map(({ createdAt, ...e }) => ({ ...e, ...(createdAt ? { createdAt } : {}) }));
  await chunked(ev, 1000, (c) => tx.insert(events).values(c));

  // Contracted MRR via the app's own rollup.
  for (const o of plan.orgs) await recomputeOrg(tx, o.id);

  await applyReconnects(tx, plan, uid);

  const ids = plan.orgs.map((o) => o.id);
  const active: ActiveOrgRow[] = [];
  await chunked(ids, 1000, async (c) => {
    const rows = await tx
      .select({ orgId: organizations.id, name: organizations.name, segment: organizations.segment, csm: users.name, mrr: organizations.contractedMrr })
      .from(organizations)
      .leftJoin(users, eq(users.id, organizations.csmId))
      .where(and(inArray(organizations.id, c), eq(organizations.lifecycle, "active")));
    active.push(...rows.map((r) => ({ orgId: r.orgId, name: r.name, segment: r.segment ?? "(none)", csm: r.csm ?? "(none)", mrr: Number(r.mrr) })));
  });
  return active;
}

/**
 * Reconnect-pipeline deals become reconnect dates. A company matched by name gets the date if it's
 * a prospect or churned (customers are skipped: their Reconnect entry is a stale clone). Unmatched
 * names become new prospects, marked as imported so --replace removes them.
 */
async function applyReconnects(tx: Tx, plan: Plan, uid: (email: string | null) => string | null) {
  const list = plan.reconnects ?? [];
  if (!list.length) return;
  // One entry per company: the soonest date wins.
  const byName = new Map<string, (typeof list)[number]>();
  for (const r of list) {
    const key = r.companyName.toLowerCase();
    const prev = byName.get(key);
    if (!prev || r.reconnectOn < prev.reconnectOn) byName.set(key, r);
  }
  const existing = await tx
    .select({ id: organizations.id, name: organizations.name, lifecycle: organizations.lifecycle, aeId: organizations.aeId })
    .from(organizations);
  const orgByName = new Map(existing.map((o) => [o.name.toLowerCase(), o]));
  const counts = { matched: 0, created: 0, skippedCustomers: 0 };
  const created: (typeof organizations.$inferInsert & { id: string })[] = [];
  for (const [key, r] of byName) {
    const org = orgByName.get(key);
    if (org) {
      if (org.lifecycle !== "prospect" && org.lifecycle !== "churned") {
        counts.skippedCustomers++;
        continue;
      }
      await tx
        .update(organizations)
        .set({ reconnectOn: r.reconnectOn, reconnectReason: r.reason, aeId: org.aeId ?? uid(r.aeEmail) })
        .where(eq(organizations.id, org.id));
      counts.matched++;
    } else {
      created.push({ id: randomUUID(), name: r.companyName, aeId: uid(r.aeEmail), reconnectOn: r.reconnectOn, reconnectReason: r.reason, salesmateCompanyId: r.salesmateCompanyId });
    }
  }
  await chunked(created, 500, (c) => tx.insert(organizations).values(c));
  await chunked(created, 1000, (c) =>
    tx.insert(events).values(c.map((o) => ({ entityType: "organization", entityId: o.id, orgId: o.id, action: "created", data: { via: VIA, name: o.name, reconnect: true } }))),
  );
  counts.created = created.length;
  console.log(
    `reconnect: ${list.length} Salesmate deals → ${byName.size} companies (${counts.matched} existing, ${counts.created} new prospects, ${counts.skippedCustomers} customers skipped)`,
  );
}

async function main() {
  const args = parseArgs();
  const dryRun = args["dry-run"] === "true";
  const dir = resolveSnapshot(args.snapshot);
  const where = assertLocalDatabase();
  console.log(`plan: ${dir}/out/plan.json → ${where}${dryRun ? " (dry run: rolled back)" : ""}`);

  if (args.purge === "true") {
    const n = await db.transaction((tx) => deletePreviousImport(tx));
    console.log(`purged ${n} imported organizations and their deals, onboardings, contacts and activities`);
    return;
  }

  const plan = readJson<Plan>(join(dir, "out", "plan.json"));
  let active: ActiveOrgRow[] = [];
  try {
    await db.transaction(async (tx) => {
      active = await load(tx, plan, args.replace === "true");
      if (dryRun) throw new DryRunRollback();
    });
  } catch (e) {
    if (!(e instanceof DryRunRollback)) throw e;
  }

  const md = reconciliationMarkdown(plan, active, dryRun ? `local DB load, rolled back (--dry-run)` : `local DB load (committed)`);
  const out = join(dir, "out", "reconciliation.md");
  writeText(out, md);
  console.log("\n" + md.split("\n## By owner")[0]);
  console.log(`full report → ${out}\nreview → ${join(dir, "out", "review.csv")}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
