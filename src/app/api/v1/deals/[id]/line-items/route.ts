import { NextResponse } from "next/server";
import { authorize, getDealLineItems } from "@/server/api";

/** GET /api/v1/deals/:id/line-items — the deal's pricing, each item with its monthly value, plus the deal's MRR. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = await authorize(req, "get_deal_line_items");
  if (caller instanceof Response) return caller;
  const res = await getDealLineItems((await params).id);
  if (!res) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { items, ...totals } = res;
  return NextResponse.json({ data: items, ...totals });
}
