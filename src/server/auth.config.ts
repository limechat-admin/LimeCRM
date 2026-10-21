import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import { ALLOWED_EMAIL_DOMAIN } from "@/domain/permissions";

/**
 * Auth.js config shared by src/proxy.ts (cookie check only) and src/server/auth.ts (which
 * adds the users-table check). Reads AUTH_SECRET, AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET.
 */
export const authConfig = {
  providers: [
    // `hd` only preselects the Workspace in Google's account picker; the real check is the
    // signIn callback in src/server/auth.ts.
    Google({ authorization: { params: { hd: ALLOWED_EMAIL_DOMAIN, prompt: "select_account" } } }),
  ],
  pages: { signIn: "/signin", error: "/signin" },
  // JWT sessions: no adapter tables. The user's role and isActive are re-read from `users` on
  // every request, so a role change or deactivation takes effect immediately.
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60 },
} satisfies NextAuthConfig;

/** Dev only: act as this seeded user without SSO. Never honoured outside `next dev`. */
export function devUserEmail(): string | null {
  return process.env.NODE_ENV === "development" ? process.env.DEV_USER_EMAIL || null : null;
}
