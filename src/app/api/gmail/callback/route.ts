import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { mailAccounts } from "@/db/schema";
import { seal, verifyState } from "@/domain/secret-box";
import { getCurrentUser } from "@/server/auth";
import { appUrl, exchangeCode, GMAIL_SCOPE, gmailClient, NONCE_COOKIE, revokeToken, tokenKey } from "@/server/gmail";

const back = (q: string) => NextResponse.redirect(`${appUrl()}/settings/email?${q}`);

/**
 * GET /api/gmail/callback: Google's redirect after consent. Checks the state and nonce, swaps the
 * code for a refresh token, confirms it's the user's own work mailbox, and stores the token sealed.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  const params = req.nextUrl.searchParams;
  const jar = await cookies();
  const nonce = jar.get(NONCE_COOKIE)?.value;
  jar.delete({ name: NONCE_COOKIE, path: "/api/gmail" });
  if (params.get("error")) return back(`error=${encodeURIComponent(params.get("error")!)}`);
  const state = verifyState(params.get("state") ?? "", tokenKey());
  if (!state || state.userId !== user.id || !nonce || state.nonce !== nonce) return back("error=expired");

  const tokens = await exchangeCode(params.get("code") ?? "").catch(() => null);
  if (!tokens?.refresh_token) return back("error=no_token");
  if (!tokens.scope?.split(" ").includes(GMAIL_SCOPE)) {
    await revokeToken(tokens.refresh_token);
    return back("error=scope");
  }
  const profile = await gmailClient(tokens.refresh_token)
    .profile()
    .catch(() => null);
  if (!profile || profile.emailAddress.toLowerCase() !== user.email.toLowerCase()) {
    // Only your own work mailbox: a personal or someone else's account is refused and its grant revoked.
    await revokeToken(tokens.refresh_token);
    return back("error=wrong_account");
  }
  const values = { email: user.email, refreshTokenSealed: seal(tokens.refresh_token, tokenKey()), status: "active", lastError: null, historyId: null };
  await db
    .insert(mailAccounts)
    .values({ userId: user.id, ...values })
    .onConflictDoUpdate({ target: mailAccounts.userId, set: values });
  return back("connected=1");
}
