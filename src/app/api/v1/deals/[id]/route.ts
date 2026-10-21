import { NextResponse } from "next/server";
import { authorize, getDealDetail } from "@/server/api";

/** GET /api/v1/deals/:id — deal with its organization, line items and what each stage's gate still needs. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = await authorize(req, "get_deal");
  if (caller instanceof Response) return caller;
  const data = await getDealDetail((await params).id);
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ data });
}
