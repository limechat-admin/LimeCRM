import { NextResponse } from "next/server";
import { actingUser, activityInput, apiError, apiJson, authorize, createActivity } from "@/server/api";

/**
 * POST /api/v1/activities { type, subject, body?, orgId?, dealId?, contactId?, dueAt?, completedAt? }
 * Logged as the API key's owner (or `actorEmail` with the shared token). 201 with the activity.
 */
export async function POST(req: Request) {
  const caller = await authorize(req, "log_activity");
  if (caller instanceof Response) return caller;
  const json = await req.json().catch(() => null);
  const parsed = activityInput.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
  }
  const actor = await actingUser(caller, typeof json?.actorEmail === "string" ? json.actorEmail : null);
  if (!actor.ok) return apiError(actor);
  return apiJson(await createActivity(actor.data, parsed.data));
}
