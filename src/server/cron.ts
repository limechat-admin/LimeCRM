import "server-only";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/** Cron endpoints authenticate with `Authorization: Bearer $CRON_SECRET` (what Vercel Cron sends). */
export function cronDenied(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  const got = Buffer.from(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  const want = Buffer.from(secret);
  return got.length === want.length && timingSafeEqual(got, want) ? null : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
