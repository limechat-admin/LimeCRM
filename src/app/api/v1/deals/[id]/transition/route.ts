import { NextResponse } from "next/server";
import { z } from "zod";
import { actingUser, apiError, apiJson, authorize, moveDeal } from "@/server/api";

const body = z.object({ stage: z.string().min(1), actorEmail: z.string().email().optional() });

/**
 * POST /api/v1/deals/:id/transition { stage }
 * Acts as the API key's owner (or `actorEmail` with the shared token), with the UI's permission
 * rules and stage gate: 403 when the role can't move this deal, 422 with the missing fields when
 * the stage's requirements aren't met.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = await authorize(req, "update_deal_stage");
  if (caller instanceof Response) return caller;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Body must be { stage }" }, { status: 400 });
  const actor = await actingUser(caller, parsed.data.actorEmail);
  if (!actor.ok) return apiError(actor);
  const res = await moveDeal(actor.data, (await params).id, parsed.data.stage);
  return res.ok ? NextResponse.json({ ok: true }) : apiJson(res);
}
