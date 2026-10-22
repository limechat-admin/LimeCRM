import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { newNonce, signState } from "@/domain/secret-box";
import { getCurrentUser } from "@/server/auth";
import { appUrl, consentUrl, gmailConfigured, NONCE_COOKIE, tokenKey } from "@/server/gmail";

/** GET /api/gmail/connect: send the signed-in user to Google to grant read-only Gmail access. */
export async function GET() {
  const user = await getCurrentUser();
  if (!gmailConfigured()) return NextResponse.redirect(`${appUrl()}/settings/email?error=not_configured`);
  const nonce = newNonce();
  // The nonce cookie ties Google's redirect back to this browser; the signed state ties it to this user.
  (await cookies()).set(NONCE_COOKIE, nonce, { httpOnly: true, sameSite: "lax", secure: appUrl().startsWith("https"), path: "/api/gmail", maxAge: 600 });
  return NextResponse.redirect(consentUrl(signState(user.id, nonce, tokenKey()), user.email));
}
