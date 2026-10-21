"use server";
/**
 * Bulk edit from the Leads and Companies lists. Each record is updated through the same functions
 * as its own page, so every change is audited, fires webhooks, and lead statuses keep the SOP's
 * requirements; records that can't take the change are reported back by name.
 */
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type { ActionState } from "@/app/actions";
import { db } from "@/db";
import { contacts, deals, organizations, segment } from "@/db/schema";
import { bulkChoice, MAX_BULK, parseBulkIds, summarizeBulk, type BulkOutcome } from "@/domain/bulk";
import { isLeadStatus, LEAD_STATUS_LABEL, type LeadStatus } from "@/domain/leads";
import { canWrite } from "@/domain/permissions";
import { RECONNECT_PRESETS, reconnectDateFor, type ReconnectPreset } from "@/domain/reconnect";
import { getCurrentUser } from "@/server/auth";
import { setLeadStatus, updateLead, type LeadPatch } from "@/server/leads";
import { updateDeal, updateOrganization } from "@/server/mutations";

async function start(fd: FormData) {
  const user = await getCurrentUser();
  const allowed = canWrite(user.role);
  if (!allowed.ok) return { error: allowed.message } as const;
  const ids = parseBulkIds(fd.get("ids"));
  if (!ids.length) return { error: "Select at least one row" } as const;
  if (ids.length > MAX_BULK) return { error: `Select at most ${MAX_BULK} rows at a time` } as const;
  return { user, ids } as const;
}

export async function bulkLeadsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const s = await start(fd);
  if ("error" in s) return { ok: false, message: s.error };
  const sdr = bulkChoice(fd.get("sdrId"));
  const owner = bulkChoice(fd.get("ownerId"));
  const status = bulkChoice(fd.get("status"));
  if (!sdr.change && !owner.change && !status.change) return { ok: false, message: "Pick something to change" };
  if (status.change && !isLeadStatus(status.value)) return { ok: false, message: "Pick a status" };

  const leads = await db.select({ id: contacts.id, name: contacts.name }).from(contacts).where(inArray(contacts.id, s.ids));
  const patch: LeadPatch = {};
  if (sdr.change) patch.sdrId = sdr.value;
  if (owner.change) patch.ownerId = owner.value;
  const owners = Object.keys(patch).length > 0;
  const outcomes: BulkOutcome[] = [];
  for (const lead of leads) {
    // Owners first: an AE is one of the requirements for Qualified Meeting / SQL.
    if (owners) await updateLead(lead.id, patch, s.user.id);
    if (!status.change || !isLeadStatus(status.value)) continue;
    const res = await setLeadStatus(lead.id, status.value, s.user.id);
    outcomes.push(res.ok ? { name: lead.name, ok: true } : { name: lead.name, ok: false, why: res.error ?? res.missing.map((m) => m.label).join(", ") });
  }
  revalidatePath("/", "layout");

  // Owner changes always apply; status moves can be refused per lead, so they're reported apart.
  const ownerLine = owners
    ? `Set ${[sdr.change && "SDR", owner.change && "AE"].filter(Boolean).join(" and ")} on ${leads.length} ${leads.length === 1 ? "lead" : "leads"}.`
    : "";
  if (!status.change) return { ok: true, message: ownerLine };
  const moved = summarizeBulk(outcomes, ["lead", "leads"], { verb: "Moved", suffix: ` to ${LEAD_STATUS_LABEL[status.value as LeadStatus]}` }).message;
  // Any refusal keeps the rows selected (red toast) so they can be fixed and retried.
  return { ok: outcomes.every((o) => o.ok), message: [ownerLine, moved].filter(Boolean).join(" ") };
}

export async function bulkCompaniesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const s = await start(fd);
  if ("error" in s) return { ok: false, message: s.error };
  const ae = bulkChoice(fd.get("aeId"));
  const om = bulkChoice(fd.get("omId"));
  const csm = bulkChoice(fd.get("csmId"));
  const seg = bulkChoice(fd.get("segment"));
  const reconnect = bulkChoice(fd.get("reconnect"));
  const moveDeals = fd.get("moveDeals") === "on";
  if (![ae, om, csm, seg, reconnect].some((c) => c.change)) return { ok: false, message: "Pick something to change" };
  if (seg.change && seg.value && !(segment.enumValues as readonly string[]).includes(seg.value)) return { ok: false, message: "Unknown segment" };
  if (reconnect.change && reconnect.value && !RECONNECT_PRESETS.some((p) => p.key === reconnect.value))
    return { ok: false, message: "Unknown reconnect option" };

  const patch: Parameters<typeof updateOrganization>[1] = {};
  if (ae.change) patch.aeId = ae.value;
  if (om.change) patch.omId = om.value;
  if (csm.change) patch.csmId = csm.value;
  if (seg.change) patch.segment = seg.value as (typeof segment.enumValues)[number] | null;
  if (reconnect.change) {
    patch.reconnectOn = reconnect.value ? reconnectDateFor(reconnect.value as ReconnectPreset, new Date()) : null;
    if (!reconnect.value) patch.reconnectReason = null;
  }

  const orgs = await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(inArray(organizations.id, s.ids));
  const outcomes: BulkOutcome[] = [];
  let dealsMoved = 0;
  for (const org of orgs) {
    await updateOrganization(org.id, patch, s.user.id);
    // Handing a book to a new AE: their open deals go with it. Won and lost deals keep their AE (they earned them).
    if (ae.change && moveDeals) {
      const open = await db
        .select({ id: deals.id })
        .from(deals)
        .where(and(eq(deals.orgId, org.id), eq(deals.status, "open")));
      for (const d of open) await updateDeal(d.id, { ownerId: ae.value }, s.user.id);
      dealsMoved += open.length;
    }
    outcomes.push({ name: org.name, ok: true });
  }
  revalidatePath("/", "layout");
  const res = summarizeBulk(outcomes, ["company", "companies"]);
  return dealsMoved ? { ...res, message: `${res.message} Moved ${dealsMoved} open ${dealsMoved === 1 ? "deal" : "deals"} to the new AE.` } : res;
}
