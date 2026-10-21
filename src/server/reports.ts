import "server-only";
import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  churnSummary,
  customerBook,
  kickoffToHandover,
  mrrBooked,
  onboardingThroughput,
  pipelineForecast,
  sdrFunnel,
  weightedMrr,
  type BookOrgRow,
  type ChurnRow,
  type CsvValue,
  type DealType,
  type LeadRow,
  type OnboardingRow,
} from "@/app/reports/aggregate";
import type { DateRange } from "@/app/reports/range";
import { db } from "@/db";
import { activities, contacts, dealLineItems, deals, onboardings, organizations, stages, users } from "@/db/schema";
import { missingFields, requiredFieldsFor } from "@/domain/gates";
import { DEAL_CHECKS, dealChecks, LEAD_CHECKS, leadChecks, scoreByPerson, type DealHygieneInput, type LeadHygieneInput } from "@/domain/hygiene";
import { CHURN_LABEL, DEAL_TYPE_LABEL, LIFECYCLE_LABEL, SEGMENT_LABEL } from "@/lib/format";
import { isLeadStatus, LEAD_STATUS_LABEL, LEAD_STATUSES, leadStatusMissing, type LeadStatus } from "@/domain/leads";

/** A timestamptz as the calendar day in India. */
const istDay = (col: unknown) => sql<string>`to_char(${col} at time zone 'Asia/Kolkata', 'YYYY-MM-DD')`;

type Csv = { header: string[]; rows: CsvValue[][] };

// ---------- 1. MRR booked ----------

export async function getMrrBooked(range: DateRange) {
  const owner = alias(users, "owner");
  const rows = await db
    .select({
      id: deals.id,
      title: deals.title,
      orgName: organizations.name,
      ownerName: owner.name,
      type: deals.type,
      mrr: deals.mrr,
      oneTimeFee: deals.oneTimeFee,
      currency: deals.currency,
      closedOn: istDay(deals.closedAt),
    })
    .from(deals)
    .innerJoin(organizations, eq(organizations.id, deals.orgId))
    .leftJoin(owner, eq(owner.id, deals.ownerId))
    .where(
      and(
        eq(deals.status, "won"),
        isNotNull(deals.closedAt),
        sql`(${deals.closedAt} at time zone 'Asia/Kolkata')::date between ${range.from} and ${range.to}`,
      ),
    )
    .orderBy(asc(deals.closedAt));
  const report = mrrBooked(rows, range);
  const csv: Csv = {
    header: ["Won on", "Deal", "Company", "AE", "Type", "MRR (INR)", "One-time (INR)", "Currency"],
    rows: report.rows.map((r) => [r.closedOn, r.title, r.orgName, r.ownerName, DEAL_TYPE_LABEL[r.type as DealType], r.mrr, r.oneTimeFee, r.currency]),
  };
  return { ...report, csv };
}

// ---------- 2. Pipeline & forecast ----------

export async function getPipeline(range: DateRange) {
  const owner = alias(users, "owner");
  const [stageRows, rows] = await Promise.all([
    db
      .select({ key: stages.key, name: stages.name, position: stages.position, winProbability: stages.winProbability })
      .from(stages)
      .where(and(eq(stages.pipeline, "sales"), eq(stages.kind, "open")))
      .orderBy(asc(stages.position)),
    db
      .select({
        id: deals.id,
        title: deals.title,
        orgName: organizations.name,
        ownerName: owner.name,
        stageKey: stages.key,
        stageName: stages.name,
        stagePosition: stages.position,
        winProbability: stages.winProbability,
        mrr: deals.mrr,
        oneTimeFee: deals.oneTimeFee,
        expectedCloseDate: deals.expectedCloseDate,
      })
      .from(deals)
      .innerJoin(organizations, eq(organizations.id, deals.orgId))
      .innerJoin(stages, eq(stages.id, deals.stageId))
      .leftJoin(owner, eq(owner.id, deals.ownerId))
      .where(and(eq(deals.status, "open"), sql`${deals.endedAt} is null`))
      .orderBy(asc(stages.position), asc(deals.expectedCloseDate)),
  ]);
  const report = pipelineForecast(rows, stageRows, range);
  const csv: Csv = {
    header: ["Deal", "Company", "AE", "Stage", "Win %", "MRR (INR)", "Weighted MRR (INR)", "One-time (INR)", "Expected close", "Closing in range", "Commit"],
    rows: report.rows.map((r) => [
      r.title,
      r.orgName,
      r.ownerName,
      r.stageName,
      r.winProbability,
      r.mrr,
      weightedMrr(r),
      r.oneTimeFee,
      r.expectedCloseDate,
      report.isClosing(r) ? "Yes" : "No",
      report.isCommit(r) ? "Yes" : "No",
    ]),
  };
  return { ...report, csv };
}

// ---------- 3. SDR funnel ----------

export async function getSdrFunnel(range: DateRange) {
  const sdr = alias(users, "sdr");
  // The company's first deal won on or after the lead became an SQL.
  const wonDeal = sql`(
    select d.closed_at, d.mrr from ${deals} d
    where d.org_id = ${contacts.orgId} and d.status = 'won' and d.closed_at is not null
      and (d.closed_at at time zone 'Asia/Kolkata')::date >= ${contacts.sqlAt}
    order by d.closed_at limit 1
  )`;
  const rows: LeadRow[] = await db
    .select({
      id: contacts.id,
      name: contacts.name,
      sdrName: sdr.name,
      leadStatus: contacts.leadStatus,
      createdOn: istDay(contacts.createdAt),
      meetingScheduledAt: contacts.meetingScheduledAt,
      meetingCompletedAt: contacts.meetingCompletedAt,
      qualifiedAt: contacts.qualifiedAt,
      sqlAt: contacts.sqlAt,
      wonOn: sql<string | null>`(select to_char(w.closed_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') from ${wonDeal} w)`,
      wonMrr: sql<number>`coalesce((select w.mrr from ${wonDeal} w), 0)::float8`,
    })
    .from(contacts)
    .leftJoin(sdr, eq(sdr.id, contacts.sdrId))
    .where(isNotNull(contacts.leadStatus));
  const report = sdrFunnel(rows, range);
  const csv: Csv = {
    header: ["Lead", "SDR", "Status", "Created", "Meeting scheduled", "Meeting completed", "Qualified", "SQL", "Won", "Won MRR (INR)"],
    rows: report.rows.map((r) => [
      r.name,
      r.sdrName,
      r.leadStatus ? (LEAD_STATUS_LABEL[r.leadStatus as LeadStatus] ?? r.leadStatus) : null,
      r.createdOn,
      r.meetingScheduledAt,
      r.meetingCompletedAt,
      r.qualifiedAt,
      r.sqlAt,
      r.wonOn,
      r.wonOn ? r.wonMrr : null,
    ]),
  };
  return { ...report, csv };
}

// ---------- 4. Customer book ----------

export async function getCustomerBook(range: DateRange) {
  const csm = alias(users, "csm");
  const [bookRows, churnRows] = await Promise.all([
    db
      .select({
        id: organizations.id,
        name: organizations.name,
        lifecycle: organizations.lifecycle,
        segment: organizations.segment,
        health: organizations.health,
        csmName: csm.name,
        contractedMrr: organizations.contractedMrr,
      })
      .from(organizations)
      .leftJoin(csm, eq(csm.id, organizations.csmId))
      .where(inArray(organizations.lifecycle, ["active", "onboarding", "on_hold"]))
      .orderBy(asc(organizations.name)),
    db
      .select({
        id: organizations.id,
        name: organizations.name,
        segment: organizations.segment,
        csmName: csm.name,
        churnedAt: sql<string>`${organizations.churnedAt}::text`,
        category: organizations.churnCategory,
        // Churn ends every live contract on the last billing date (src/server/transitions.ts).
        churnedMrr: sql<number>`coalesce((
          select sum(d.mrr) from ${deals} d
          where d.org_id = ${organizations.id} and d.status = 'won' and d.ended_at = ${organizations.churnLastBillingDate}
        ), 0)::float8`,
      })
      .from(organizations)
      .leftJoin(csm, eq(csm.id, organizations.csmId))
      .where(sql`${organizations.churnedAt} between ${range.from} and ${range.to}`)
      .orderBy(asc(organizations.churnedAt)),
  ]);
  const book = customerBook(bookRows as BookOrgRow[]);
  const churn = churnSummary(churnRows as ChurnRow[], range);
  const csv: Csv = {
    header: ["Company", "Status", "Segment", "CSM", "Health", "Contracted MRR (INR)", "Churned on", "Churn category", "Churned MRR (INR)"],
    rows: [
      ...book.rows.map((r) => [
        r.name,
        LIFECYCLE_LABEL[r.lifecycle],
        r.segment ? SEGMENT_LABEL[r.segment as keyof typeof SEGMENT_LABEL] : null,
        r.csmName,
        r.health,
        r.contractedMrr,
        null,
        null,
        null,
      ]),
      ...churn.rows.map((r) => [
        r.name,
        LIFECYCLE_LABEL.churned,
        r.segment ? SEGMENT_LABEL[r.segment as keyof typeof SEGMENT_LABEL] : null,
        r.csmName,
        null,
        0,
        r.churnedAt,
        r.category ? CHURN_LABEL[r.category as keyof typeof CHURN_LABEL] : null,
        r.churnedMrr,
      ]),
    ],
  };
  return { book, churn, csv };
}

// ---------- 5. Onboarding throughput ----------

export async function getOnboardingThroughput(range: DateRange) {
  const om = alias(users, "om");
  const stageNames = Object.fromEntries(
    (await db.select({ key: stages.key, name: stages.name }).from(stages).where(eq(stages.pipeline, "onboarding"))).map((s) => [s.key, s.name]),
  );
  // Stage events record the stage *name* they moved to (src/server/transitions.ts).
  const enteredOn = (stageName: string | undefined) =>
    sql<string | null>`(
      select to_char(min(e.created_at) at time zone 'Asia/Kolkata', 'YYYY-MM-DD') from events e
      where e.entity_type = 'onboarding' and e.entity_id = ${onboardings.id}
        and e.action = 'stage_changed' and e.data->>'to' = ${stageName ?? ""}
    )`;
  const rows: OnboardingRow[] = await db
    .select({
      id: onboardings.id,
      orgName: organizations.name,
      omName: om.name,
      stageName: stages.name,
      openedOn: sql<string>`coalesce((
        select to_char(min(e.created_at) at time zone 'Asia/Kolkata', 'YYYY-MM-DD') from events e
        where e.entity_type = 'onboarding' and e.entity_id = ${onboardings.id} and e.action = 'created'
      ), to_char(${onboardings.createdAt} at time zone 'Asia/Kolkata', 'YYYY-MM-DD'))`,
      kickoffOn: sql<string | null>`coalesce(${onboardings.kickoffDate}::text, ${enteredOn(stageNames.implementation)})`,
      handedOn: enteredOn(stageNames.handed_to_cs),
    })
    .from(onboardings)
    .innerJoin(organizations, eq(organizations.id, onboardings.orgId))
    .innerJoin(stages, eq(stages.id, onboardings.stageId))
    .leftJoin(om, eq(om.id, onboardings.omId));
  const report = onboardingThroughput(rows, range);
  const csv: Csv = {
    header: ["Company", "Onboarding manager", "Current stage", "Opened", "Kick-off", "Handed to CS", "Days kick-off → CS"],
    rows: report.rows.map((r) => [r.orgName, r.omName, r.stageName, r.openedOn, r.kickoffOn, r.handedOn, kickoffToHandover(r)]),
  };
  return { ...report, csv };
}

// ---------- 6. CRM hygiene ----------

/**
 * Hygiene as of now: every open deal, plus deals won or lost in the period, scored per AE; and
 * every lead still being worked, plus leads closed in the period, scored per SDR.
 */
export async function getHygiene(range: DateRange) {
  const now = new Date();
  const owner = alias(users, "owner");
  const sdr = alias(users, "sdr");
  const closedInRange = sql`(${deals.closedAt} at time zone 'Asia/Kolkata')::date between ${range.from} and ${range.to}`;
  const [salesStages, dealRows] = await Promise.all([
    db.select().from(stages).where(eq(stages.pipeline, "sales")),
    db
      .select({ deal: deals, org: organizations, ownerName: owner.name })
      .from(deals)
      .innerJoin(organizations, eq(organizations.id, deals.orgId))
      .leftJoin(owner, eq(owner.id, deals.ownerId))
      .where(or(and(eq(deals.status, "open"), isNull(deals.endedAt)), and(inArray(deals.status, ["won", "lost"]), closedInRange))),
  ]);
  const dealIds = dealRows.map((r) => r.deal.id);
  const [items, touches, openTasks] = dealIds.length
    ? await Promise.all([
        db.select().from(dealLineItems).where(inArray(dealLineItems.dealId, dealIds)),
        db
          .select({ dealId: activities.dealId, at: sql<Date>`max(greatest(${activities.createdAt}, coalesce(${activities.completedAt}, ${activities.createdAt})))` })
          .from(activities)
          .where(inArray(activities.dealId, dealIds))
          .groupBy(activities.dealId),
        db.selectDistinct({ dealId: activities.dealId }).from(activities).where(and(inArray(activities.dealId, dealIds), isNull(activities.completedAt))),
      ])
    : [[], [], []];
  const itemsBy = new Map<string, typeof items>();
  for (const i of items) itemsBy.set(i.dealId, [...(itemsBy.get(i.dealId) ?? []), i]);
  const touchBy = new Map(touches.map((t) => [t.dealId, new Date(t.at)]));
  const tasks = new Set(openTasks.map((t) => t.dealId));
  const stageById = new Map(salesStages.map((st) => [st.id, st]));

  const dealInputs: DealHygieneInput[] = dealRows.map(({ deal, org, ownerName }) => {
    const stage = stageById.get(deal.stageId)!;
    const activity = touchBy.get(deal.id);
    return {
      id: deal.id,
      title: deal.title,
      orgName: org.name,
      ownerId: deal.ownerId,
      ownerName,
      status: deal.status,
      stageMissing: missingFields({ deal, lineItems: itemsBy.get(deal.id) ?? [], org }, requiredFieldsFor(salesStages, stage)).map((m) => m.label),
      expectedCloseDate: deal.expectedCloseDate,
      primaryContactId: deal.primaryContactId,
      lastTouchAt: activity && activity > deal.updatedAt ? activity : deal.updatedAt,
      hasOpenTask: tasks.has(deal.id),
    };
  });
  const dealKeys = DEAL_CHECKS.map((c) => c.key);
  const ae = scoreByPerson(
    dealInputs,
    dealKeys,
    (d) => ({ id: d.ownerId, name: d.ownerName }),
    (d) => dealChecks(d, now),
    (d) => ({ id: d.id, title: d.title, orgName: d.orgName }),
  );

  // Leads: being worked (open / on hold), or closed (won / lost status) and touched in the period.
  const kindOf = Object.fromEntries(LEAD_STATUSES.map((st) => [st.key, st.kind])) as Record<string, string>;
  const leadRows = await db
    .select({ c: contacts, orgName: organizations.name, sdrName: sdr.name })
    .from(contacts)
    .leftJoin(organizations, eq(organizations.id, contacts.orgId))
    .leftJoin(sdr, eq(sdr.id, contacts.sdrId))
    .where(isNotNull(contacts.leadStatus));
  const leadTouches = leadRows.length
    ? await db
        .select({ contactId: activities.contactId, at: sql<Date>`max(${activities.createdAt})` })
        .from(activities)
        .where(isNotNull(activities.contactId))
        .groupBy(activities.contactId)
    : [];
  const leadTouchBy = new Map(leadTouches.map((t) => [t.contactId, new Date(t.at)]));
  const inPeriod = (d: Date) => {
    const day = new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
    return day >= range.from && day <= range.to;
  };
  const leadInputs: LeadHygieneInput[] = leadRows
    .filter(({ c }) => ["open", "hold"].includes(kindOf[c.leadStatus!]) || inPeriod(c.updatedAt))
    .map(({ c, orgName, sdrName }) => {
      const activity = leadTouchBy.get(c.id);
      return {
        id: c.id,
        name: c.name,
        orgName,
        sdrId: c.sdrId,
        sdrName,
        kind: kindOf[c.leadStatus!] ?? "open",
        statusMissing: isLeadStatus(c.leadStatus) ? leadStatusMissing(c, c.leadStatus).map((m) => m.label) : [],
        lastTouchAt: activity && activity > c.updatedAt ? activity : c.updatedAt,
      };
    });
  const sdrScores = scoreByPerson(
    leadInputs,
    LEAD_CHECKS.map((c) => c.key),
    (l) => ({ id: l.sdrId, name: l.sdrName }),
    (l) => leadChecks(l, now),
    (l) => ({ id: l.id, title: l.name, orgName: l.orgName }),
  );

  const pctCell = (n: number | null) => (n === null ? "" : Math.round(n * 100));
  const csv: Csv = {
    header: ["Role", "Person", "Score %", "Records", ...DEAL_CHECKS.map((c) => `${c.label} %`), ...LEAD_CHECKS.map((c) => `Lead ${c.label.toLowerCase()} %`), "Records to fix"],
    rows: [
      ...ae.people.map((p) => [
        "AE",
        p.name,
        pctCell(p.score),
        p.records,
        ...DEAL_CHECKS.map((c) => pctCell(checkShare(p.byCheck[c.key]))),
        ...LEAD_CHECKS.map(() => ""),
        p.failing.length,
      ]),
      ...sdrScores.people.map((p) => [
        "SDR",
        p.name,
        pctCell(p.score),
        p.records,
        ...DEAL_CHECKS.map(() => ""),
        ...LEAD_CHECKS.map((c) => pctCell(checkShare(p.byCheck[c.key]))),
        p.failing.length,
      ]),
    ],
  };
  return { ae, sdr: sdrScores, csv };
}

const checkShare = (t: { passed: number; total: number }) => (t.total ? t.passed / t.total : null);

export const REPORTS = {
  mrr: { title: "MRR booked", load: getMrrBooked, fallback: "this_month" },
  pipeline: { title: "Pipeline and forecast", load: getPipeline, fallback: "this_month" },
  sdr: { title: "SDR funnel", load: getSdrFunnel, fallback: "this_month" },
  book: { title: "Customer book", load: getCustomerBook, fallback: "quarter" },
  onboarding: { title: "Onboarding throughput", load: getOnboardingThroughput, fallback: "quarter" },
  hygiene: { title: "CRM hygiene", load: getHygiene, fallback: "this_month" },
} as const;

export type ReportKey = keyof typeof REPORTS;
export const isReportKey = (k: string): k is ReportKey => k in REPORTS;
