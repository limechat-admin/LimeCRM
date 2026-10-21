import { NextResponse } from "next/server";
import { resolveViewer, signOut } from "@/server/auth";

/**
 * Where getCurrentUser sends a session whose user was deactivated or removed: clears the cookie
 * and shows why on /signin. Re-checks first, so a link here can't sign out someone still allowed in.
 * (Signing out from the app is a POST: signOutAction.)
 */
export async function GET(req: Request) {
  const viewer = await resolveViewer();
  if (viewer.user) return NextResponse.redirect(new URL("/", req.url));
  const to = viewer.reason === "signed_out" ? "/signin" : `/signin?error=${viewer.reason}`;
  await signOut({ redirectTo: to });
}
