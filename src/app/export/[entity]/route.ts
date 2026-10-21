import { asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { deals, organizations, stages, users } from "@/db/schema";
import { toCsv, type CsvColumn } from "@/domain/csv";
import { bantTotal, LEAD_STAGES, LEAD_STATUS_LABEL, type LeadStatus } from "@/domain/leads";
import { istDay } from "@/domain/work";
import { CYCLE_LABEL, DEAL_TYPE_LABEL, LIFECYCLE_LABEL, SEGMENT_LABEL } from "@/lib/format";
import { resolveViewer } from "@/server/auth";
import { listLeads, listOrganizations, type LeadFilters } from "@/server/queries";

const EXPORT_LIMIT = 50_000;

async function exportDeals() {
  const owner = alias(users, "owner");
  const sdr = alias(users, "sdr");
  const rows = await db
    .select({ d: deals, stage: stages.name, org: organizations.name, owner: owner.name, sdr: sdr.name })
    .from(deals)
    .innerJoin(stages, eq(stages.id, deals.stageId))
    .innerJoin(organizations, eq(organizations.id, deals.orgId))
    .leftJoin(owner, eq(owner.id, deals.ownerId))
    .leftJoin(sdr, eq(sdr.id, deals.sdrId))
    .orderBy(asc(organizations.name), asc(deals.createdAt))
    .limit(EXPORT_LIMIT);
  type R = (typeof rows)[number];
  const cols: CsvColumn<R>[] = [
    { header: "Deal ID", value: (r) => r.d.id },
    { header: "Title", value: (r) => r.d.title },
    { header: "Company", value: (r) => r.org },
    { header: "Type", value: (r) => DEAL_TYPE_LABEL[r.d.type] },
    { header: "Stage", value: (r) => r.stage },
    { header: "Status", value: (r) => r.d.status },
    { header: "MRR (INR/month)", value: (r) => r.d.mrr },
    { header: "One-time fee", value: (r) => r.d.oneTimeFee },
    { header: "Currency", value: (r) => r.d.currency },
    { header: "Billing cycle", value: (r) => (r.d.billingCycle ? CYCLE_LABEL[r.d.billingCycle] : "") },
    { header: "AE", value: (r) => r.owner },
    { header: "SDR", value: (r) => r.sdr },
    { header: "Plan", value: (r) => r.d.plan },
    { header: "Products", value: (r) => r.d.products },
    { header: "Source", value: (r) => r.d.source },
    { header: "Partner", value: (r) => r.d.partnerName },
    { header: "Expected close", value: (r) => r.d.expectedCloseDate },
    { header: "Closed", value: (r) => (r.d.closedAt ? istDay(r.d.closedAt) : "") },
    { header: "Contract start", value: (r) => r.d.contractStart },
    { header: "Contract renewal", value: (r) => r.d.contractRenewal },
    { header: "Contract ended", value: (r) => r.d.endedAt },
    { header: "Lost reason", value: (r) => r.d.lostReason },
    { header: "Created", value: (r) => istDay(r.d.createdAt) },
  ];
  return toCsv(rows, cols);
}

async function exportCompanies() {
  const rows = await listOrganizations();
  type R = (typeof rows)[number];
  const cols: CsvColumn<R>[] = [
    { header: "Company ID", value: (r) => r.id },
    { header: "Name", value: (r) => r.name },
    { header: "Lifecycle", value: (r) => LIFECYCLE_LABEL[r.lifecycle] },
    { header: "Segment", value: (r) => (r.segment ? SEGMENT_LABEL[r.segment] : "") },
    { header: "Contracted MRR (INR/month)", value: (r) => r.contractedMrr },
    { header: "HQ city", value: (r) => r.hqCity },
    { header: "AE", value: (r) => r.aeName },
    { header: "CSM", value: (r) => r.csmName },
    { header: "LC Account IDs", value: (r) => r.lcAccountIds },
  ];
  return toCsv(rows, cols);
}

async function exportLeads(filters: LeadFilters) {
  const { rows } = await listLeads(filters, EXPORT_LIMIT);
  type R = (typeof rows)[number];
  const cols: CsvColumn<R>[] = [
    { header: "Contact ID", value: (r) => r.c.id },
    { header: "Name", value: (r) => r.c.name },
    { header: "Email", value: (r) => r.c.email },
    { header: "Phone", value: (r) => r.c.phone },
    { header: "Designation", value: (r) => r.c.designation },
    { header: "Company", value: (r) => r.orgName },
    { header: "Lead status", value: (r) => (r.c.leadStatus ? (LEAD_STATUS_LABEL[r.c.leadStatus as LeadStatus] ?? r.c.leadStatus) : "") },
    { header: "Lead stage", value: (r) => (r.c.leadStage ? (LEAD_STAGES[r.c.leadStage as keyof typeof LEAD_STAGES] ?? r.c.leadStage) : "") },
    { header: "BANT", value: (r) => bantTotal(r.c) },
    { header: "SDR", value: (r) => r.sdrName },
    { header: "AE", value: (r) => r.ownerName },
    { header: "Source", value: (r) => r.c.source },
    { header: "Product interest", value: (r) => r.c.productInterest },
    { header: "Meeting scheduled", value: (r) => r.c.meetingScheduledAt },
    { header: "Meeting completed", value: (r) => r.c.meetingCompletedAt },
    { header: "Qualified", value: (r) => r.c.qualifiedAt },
    { header: "SQL", value: (r) => r.c.sqlAt },
    { header: "LinkedIn", value: (r) => r.c.linkedinUrl },
  ];
  return toCsv(rows, cols);
}

/** GET /export/deals.csv | /export/companies.csv | /export/leads.csv (leads take the page's filters). */
export async function GET(req: Request, { params }: { params: Promise<{ entity: string }> }) {
  const { user } = await resolveViewer();
  if (!user) return NextResponse.json({ error: "Sign in to export" }, { status: 401 });
  const entity = (await params).entity.replace(/\.csv$/, "");
  const q = new URL(req.url).searchParams;
  let csv: string;
  if (entity === "deals") csv = await exportDeals();
  else if (entity === "companies") csv = await exportCompanies();
  else if (entity === "leads") {
    csv = await exportLeads({
      q: q.get("q") || undefined,
      status: q.get("status") || undefined,
      ownerId: q.get("ownerId") || undefined,
      sdrId: q.get("sdrId") || undefined,
    });
  } else return NextResponse.json({ error: "Unknown export" }, { status: 404 });

  const stamp = istDay(new Date());
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="limecrm-${entity}-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
