import { NextResponse } from "next/server";
import { authorize, getLeadDetail } from "@/server/api";

/** GET /api/v1/leads/:id — lead with BANT total, company and the company's deals. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = await authorize(req, "get_lead");
  if (caller instanceof Response) return caller;
  const data = await getLeadDetail((await params).id);
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ data });
}
