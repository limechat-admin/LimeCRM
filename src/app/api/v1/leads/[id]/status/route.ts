import { NextResponse } from "next/server";
import { z } from "zod";
import { actingUser, apiError, apiJson, authorize, changeLeadStatus } from "@/server/api";

const body = z.object({ status: z.string().min(1), actorEmail: z.string().email().optional() });

/**
 * POST /api/v1/leads/:id/status { status }
 * Same requirements as the UI: 422 with the missing fields. Qualified Meeting / SQL opens a deal
 * for the company (or links its open one) and returns its id.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = await authorize(req, "set_lead_status");
  if (caller instanceof Response) return caller;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Body must be { status }" }, { status: 400 });
  const actor = await actingUser(caller, parsed.data.actorEmail);
  if (!actor.ok) return apiError(actor);
  return apiJson(await changeLeadStatus(actor.data, (await params).id, parsed.data.status));
}
