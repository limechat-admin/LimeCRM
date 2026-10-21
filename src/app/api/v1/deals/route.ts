import { NextResponse } from "next/server";
import { apiError, authorize, searchDeals } from "@/server/api";

/**
 * GET /api/v1/deals?stage=proposal&status=open&owner=me&q=acme&orgId=…&limit=100&offset=0
 * Deals, most recently updated first. `owner` is a user id, an email or "me" (the key's owner).
 */
export async function GET(req: Request) {
  const caller = await authorize(req, "search_deals");
  if (caller instanceof Response) return caller;
  const params = Object.fromEntries(new URL(req.url).searchParams);
  const res = await searchDeals(params, caller);
  if (!res.ok) return apiError(res);
  return NextResponse.json({ data: res.data, total: res.total });
}
