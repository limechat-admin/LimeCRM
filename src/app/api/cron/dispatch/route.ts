import { NextResponse } from "next/server";
import { cronDenied } from "@/server/cron";
import { dispatchPending } from "@/server/notify";
import { dispatchWebhooks } from "@/server/webhooks";

/** Every few minutes: send queued Slack notifications and webhooks, and retry failures. */
export async function GET(req: Request) {
  const denied = cronDenied(req);
  if (denied) return denied;
  const [slack, webhooks] = await Promise.all([dispatchPending(200), dispatchWebhooks(200)]);
  return NextResponse.json({ slack, webhooks });
}
