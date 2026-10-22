import { NextResponse } from "next/server";
import { cronDenied } from "@/server/cron";
import { dispatchPending } from "@/server/notify";
import { dispatchWebhooks } from "@/server/webhooks";
import { dispatchCampaigns } from "@/server/campaigns";
import { campaignSetupProblems } from "@/server/postmark";

/** Every few minutes: send queued Slack notifications, webhooks and campaign email (and start scheduled campaigns); retry failures. */
export async function GET(req: Request) {
  const denied = cronDenied(req);
  if (denied) return denied;
  const [slack, webhooks, email] = await Promise.all([
    dispatchPending(200),
    dispatchWebhooks(200),
    campaignSetupProblems().length ? Promise.resolve({ skipped: "Postmark not configured" }) : dispatchCampaigns(),
  ]);
  return NextResponse.json({ slack, webhooks, email });
}
