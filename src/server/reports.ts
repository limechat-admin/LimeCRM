import "server-only";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
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
import { contacts, deals, onboardings, organizations, stages, users } from "@/db/schema";
import { CHURN_LABEL, DEAL_TYPE_LABEL, LIFECYCLE_LABEL, SEGMENT_LABEL } from "@/lib/format";
import { LEAD_STATUS_LABEL, type LeadStatus } from "@/domain/leads";

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

export const REPORTS = {
  mrr: { title: "MRR booked", load: getMrrBooked, fallback: "this_month" },
  pipeline: { title: "Pipeline and forecast", load: getPipeline, fallback: "this_month" },
  sdr: { title: "SDR funnel", load: getSdrFunnel, fallback: "this_month" },
  book: { title: "Customer book", load: getCustomerBook, fallback: "quarter" },
  onboarding: { title: "Onboarding throughput", load: getOnboardingThroughput, fallback: "quarter" },
} as const;

export type ReportKey = keyof typeof REPORTS;
export const isReportKey = (k: string): k is ReportKey => k in REPORTS;
