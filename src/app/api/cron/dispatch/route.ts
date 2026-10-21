import { NextResponse } from "next/server";
import { cronDenied } from "@/server/cron";
import { dispatchPending } from "@/server/notify";

/** Every few minutes: send queued Slack notifications and retry failures. */
export async function GET(req: Request) {
  const denied = cronDenied(req);
  if (denied) return denied;
  return NextResponse.json(await dispatchPending(200));
}
