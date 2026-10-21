import { NextResponse } from "next/server";
import { authorize, getOrganizationDetail } from "@/server/api";

/** GET /api/v1/organizations/:id — organization with deals, contacts and onboarding. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = await authorize(req, "get_organization");
  if (caller instanceof Response) return caller;
  const data = await getOrganizationDetail((await params).id);
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ data });
}
