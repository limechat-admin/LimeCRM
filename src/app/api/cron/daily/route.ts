import { NextResponse } from "next/server";
import { cronDenied } from "@/server/cron";
import { dispatchPending, queueDigests, queueRenewals } from "@/server/notify";
import { getMyWork } from "@/server/work";

/** Once a day (morning IST): renewal reminders, each person's digest DM, then send. Safe to re-run. */
export async function GET(req: Request) {
  const denied = cronDenied(req);
  if (denied) return denied;
  const renewals = await queueRenewals();
  const digests = await queueDigests((userId) => getMyWork(userId));
  const sent = await dispatchPending(500);
  return NextResponse.json({ renewals, digests, ...sent });
}
