import { NextResponse } from "next/server";
import { apiError, authorize, searchLeads } from "@/server/api";

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
