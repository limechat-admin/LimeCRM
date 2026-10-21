import type { Contact } from "@/db/schema";
import type { MissingField } from "./gates";

/**
 * Lead lifecycle, from Salesmate's "Lead Status Drop Down" and the SOPs (docs/salesmate-inventory.md §4.2).
 * Statuses are ordered as an SDR works a lead; `disqualified` and `duplicate` are terminal side exits.
 */
export const LEAD_STATUSES = [
  { key: "not_contacted", label: "Not contacted", kind: "open" },
  { key: "attempted_contact", label: "Attempted contact", kind: "open" },
  { key: "ongoing", label: "Ongoing", kind: "open" },
  { key: "deferred", label: "Deferred", kind: "hold" },
  { key: "meeting_scheduled", label: "Meeting scheduled", kind: "open" },
  { key: "meeting_completed", label: "Meeting completed", kind: "open" },
  { key: "qualified_meeting", label: "Qualified meeting", kind: "won" },
  { key: "sql", label: "SQL", kind: "won" },
  { key: "disqualified", label: "Disqualified", kind: "lost" },
  { key: "duplicate", label: "Duplicate", kind: "lost" },
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number]["key"];

export const LEAD_STATUS_LABEL = Object.fromEntries(LEAD_STATUSES.map((s) => [s.key, s.label])) as Record<LeadStatus, string>;

export const isLeadStatus = (v: unknown): v is LeadStatus => LEAD_STATUSES.some((s) => s.key === v);

/** Marketing's lead stage label (inbound qualification), separate from the SDR's working status. */
export const LEAD_STAGES = { lead: "Lead", mgl: "MGL", mql: "MQL", sql: "SQL", partnership: "Partnership" } as const;

/** Qualification thresholds from the SDR SOP: Qualified Meeting 50–74, SQL 75+. */
export const QUALIFIED_MEETING_MIN = 50;
export const SQL_MIN = 75;

type Bant = Pick<Contact, "bantBudget" | "bantAuthority" | "bantNeed" | "bantTimeline">;

/** Total BANT score, or null until all four parts are scored. */
export function bantTotal(c: Bant): number | null {
  const parts = [c.bantBudget, c.bantAuthority, c.bantNeed, c.bantTimeline];
  if (parts.some((p) => p === null || p === undefined)) return null;
  return parts.reduce<number>((a, p) => a + (p as number), 0);
}

/** The status a completed meeting earns from its BANT score. */
export function qualificationFor(total: number | null): "meeting_completed" | "qualified_meeting" | "sql" {
  if (total === null || total < QUALIFIED_MEETING_MIN) return "meeting_completed";
  return total >= SQL_MIN ? "sql" : "qualified_meeting";
}

type LeadForGate = Bant & Pick<Contact, "ownerId" | "productInterest" | "meetingScheduledAt" | "meetingCompletedAt" | "disqualifiedReason" | "orgId">;

/** What a lead needs before it can take a status. Mirrors the SDR SOP's "update these when…" lists. */
export function leadStatusMissing(lead: LeadForGate, status: LeadStatus): MissingField[] {
  const missing: MissingField[] = [];
  const need = (ok: boolean, key: string, label: string) => {
    if (!ok) missing.push({ key, label });
  };
  const total = bantTotal(lead);
  switch (status) {
    case "meeting_scheduled":
      need(!!lead.meetingScheduledAt, "lead.meeting_scheduled_at", "Meeting date");
      break;
    case "meeting_completed":
      need(!!lead.meetingCompletedAt, "lead.meeting_completed_at", "Meeting completed date");
      break;
    case "qualified_meeting":
    case "sql":
      need(!!lead.orgId, "lead.org", "Company");
      need(!!lead.meetingCompletedAt, "lead.meeting_completed_at", "Meeting completed date");
      need(!!lead.ownerId, "lead.owner", "Account Executive (owner)");
      need(lead.productInterest.length > 0, "lead.product_interest", "Product interest");
      need(total !== null, "lead.bant", "All four BANT scores");
      if (total !== null) {
        const min = status === "sql" ? SQL_MIN : QUALIFIED_MEETING_MIN;
        need(total >= min, "lead.bant_threshold", `BANT score of at least ${min} (now ${total})`);
      }
      break;
    case "disqualified":
      need(!!lead.disqualifiedReason?.trim(), "lead.disqualified_reason", "Disqualification reason");
      break;
  }
  return missing;
}

/** The Sales stage a deal is auto-created at when a lead reaches this status (none for other statuses). */
export function dealStageForLead(status: LeadStatus): "qualified_meeting" | "sql" | null {
  return status === "qualified_meeting" || status === "sql" ? status : null;
}
