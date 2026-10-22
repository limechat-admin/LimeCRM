import { NextResponse } from "next/server";
import { cronDenied } from "@/server/cron";
import { syncAllMailboxes } from "@/server/mail-sync";

/** Every few minutes: pull new email from every connected Gmail mailbox. */
export async function GET(req: Request) {
  const denied = cronDenied(req);
  if (denied) return denied;
  const results = await syncAllMailboxes();
  return NextResponse.json({ mailboxes: results.length, logged: results.reduce((a, r) => a + r.logged, 0), results });
}

// Several mailboxes at a few hundred messages each can take a while.
export const maxDuration = 300;
