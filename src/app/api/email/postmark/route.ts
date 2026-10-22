import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { handlePostmarkEvent } from "@/server/campaigns";

/**
 * POST /api/email/postmark: Postmark webhooks (Delivery, Open, Click, Bounce, SpamComplaint,
 * SubscriptionChange) for the broadcast stream. Set the webhook URL in Postmark with Basic auth:
 * https://postmark:<POSTMARK_WEBHOOK_SECRET>@<host>/api/email/postmark
 */
export async function POST(req: Request) {
  const secret = process.env.POSTMARK_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook secret not configured" }, { status: 503 });
  const given = Buffer.from((req.headers.get("authorization") ?? "").replace(/^Basic\s+/i, ""), "base64").toString("utf8");
  const expected = `postmark:${secret}`;
  if (given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const event = await req.json().catch(() => null);
  if (!event?.RecordType) return NextResponse.json({ error: "Not a Postmark event" }, { status: 400 });
  return NextResponse.json({ handled: await handlePostmarkEvent(event) });
}
