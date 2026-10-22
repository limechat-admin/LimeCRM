import { NextResponse } from "next/server";
import { verifyToken } from "@/domain/secret-box";
import { recordUnsubscribe } from "@/server/campaigns";
import { tokenKey } from "@/server/gmail";

/**
 * POST /api/email/unsubscribe/:token: RFC 8058 one-click unsubscribe (Gmail's and Yahoo's
 * "Unsubscribe" button). No sign-in: the signed token names the address and campaign.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const data = verifyToken<{ e: string; c: string }>((await params).token, tokenKey());
  if (!data?.e) return NextResponse.json({ error: "Invalid link" }, { status: 400 });
  await recordUnsubscribe(data.e, data.c);
  return NextResponse.json({ unsubscribed: true });
}
