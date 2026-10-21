import { NextResponse } from "next/server";
import { cronDenied } from "@/server/cron";
import { dispatchPending, queueDigests, queueRenewals } from "@/server/notify";
import { openReconnectTasks } from "@/server/reconnect";
import { getMyWork } from "@/server/work";

/** Once a day (morning IST): reconnect tasks, renewal reminders, each person's digest DM, then send. Safe to re-run. */
export async function GET(req: Request) {
  const denied = cronDenied(req);
  if (denied) return denied;
  // Before the digests, so today's reconnects are in them.
  const reconnects = await openReconnectTasks();
  const renewals = await queueRenewals();
  const digests = await queueDigests((userId) => getMyWork(userId));
  const sent = await dispatchPending(500);
  return NextResponse.json({ reconnects, renewals, digests, ...sent });
}
