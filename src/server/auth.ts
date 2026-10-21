import "server-only";
import { sql } from "drizzle-orm";
import NextAuth from "next-auth";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db";
import { users, type User } from "@/db/schema";
import { signInDecision, type SignInRefusal } from "@/domain/permissions";
import { authConfig, devUserEmail } from "./auth.config";

async function findUserByEmail(email: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${email.toLowerCase()}`);
  return user;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    // Google SSO, limechat.ai Workspace only, and only for people already in `users`.
    async signIn({ profile }) {
      const identity = { email: profile?.email, emailVerified: profile?.email_verified, hostedDomain: profile?.hd as string | undefined };
      const user = identity.email ? await findUserByEmail(identity.email) : undefined;
      const refusal = signInDecision(identity, user);
      return refusal ? `/signin?error=${refusal}` : true;
    },
  },
});

export type Viewer = { user: User; via: "sso" | "dev" } | { user: null; reason: "signed_out" | SignInRefusal };

/** Who is making this request, re-checked against `users` every time. Never throws or redirects. */
export const resolveViewer = cache(async (): Promise<Viewer> => {
  const devEmail = devUserEmail();
  if (devEmail) {
    const user = await findUserByEmail(devEmail);
    if (!user) throw new Error(`DEV_USER_EMAIL ${devEmail} is not a user. Run \`pnpm db:seed\`.`);
    return { user, via: "dev" };
  }
  const email = (await auth())?.user?.email;
  if (!email) return { user: null, reason: "signed_out" };
  const user = await findUserByEmail(email);
  if (!user) return { user: null, reason: "not_provisioned" };
  if (!user.isActive) return { user: null, reason: "inactive" };
  return { user, via: "sso" };
});

/**
 * Current user. Google SSO in production; `next dev` can run as DEV_USER_EMAIL instead.
 * Redirects to sign-in when there's no session, and through /signout (which clears it) when the
 * session belongs to someone who has since been deactivated or removed.
 */
export async function getCurrentUser(): Promise<User> {
  const viewer = await resolveViewer();
  if (viewer.user) return viewer.user;
  redirect(viewer.reason === "signed_out" ? "/signin" : `/signout?error=${viewer.reason}`);
}
