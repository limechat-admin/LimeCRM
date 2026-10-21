import { NextResponse } from "next/server";
import { actingUser, apiError, apiJson, authorize, intakeLead, leadInput, searchLeads } from "@/server/api";

/**
 * GET /api/v1/leads?status=meeting_scheduled&owner=me&sdr=…&q=acme
 * Leads, most recently updated first (up to 100), with per-status counts for the same filters.
 */
export async function GET(req: Request) {
  const caller = await authorize(req, "search_leads");
  if (caller instanceof Response) return caller;
  const params = new URL(req.url).searchParams;
  const pick = (k: string) => params.get(k) || undefined;
  const res = await searchLeads({ q: pick("q"), status: pick("status"), owner: pick("owner"), sdr: pick("sdr") }, caller);
  if (!res.ok) return apiError(res);
  return NextResponse.json({ data: res.data, counts: res.counts });
}

/**
 * POST /api/v1/leads { name, companyName, email?, phone?, designation?, website?, linkedinUrl?,
 *   source?, productInterest?, sdr?, owner?, message? }
 * For the website demo form and the AI SDR. 201 with { leadId, orgId, created: true }; if someone
 * with that email already exists, 200 with their leadId and created: false (the message is logged on them).
 */
export async function POST(req: Request) {
  const caller = await authorize(req, "create_lead");
  if (caller instanceof Response) return caller;
  const json = await req.json().catch(() => null);
  const parsed = leadInput.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
  }
  const actor = await actingUser(caller, typeof json?.actorEmail === "string" ? json.actorEmail : null);
  if (!actor.ok) return apiError(actor);
  return apiJson(await intakeLead(actor.data, caller, parsed.data));
}
