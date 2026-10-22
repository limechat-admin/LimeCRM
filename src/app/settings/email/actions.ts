"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type { ActionState } from "@/app/actions";
import { db } from "@/db";
import { mailAccounts, mailExclusions } from "@/db/schema";
import { normalizeEmail } from "@/domain/fields";
import { canWrite } from "@/domain/permissions";
import { unseal } from "@/domain/secret-box";
import { getCurrentUser } from "@/server/auth";
import { revokeToken, tokenKey } from "@/server/gmail";
import { syncAccount } from "@/server/mail-sync";

const PATH = "/settings/email";

async function myAccount() {
  const user = await getCurrentUser();
  const [account] = await db.select().from(mailAccounts).where(eq(mailAccounts.userId, user.id));
  return { user, account };
}

export async function syncNowAction(): Promise<ActionState> {
  const { account } = await myAccount();
  if (!account) return { ok: false, message: "Connect Gmail first" };
  if (account.status === "paused") return { ok: false, message: "Resume syncing first" };
  const r = await syncAccount(account);
  revalidatePath("/", "layout");
  if (r.error) return { ok: false, message: r.error };
  const extra = [
    r.contactsCreated && `${r.contactsCreated} new ${r.contactsCreated === 1 ? "contact" : "contacts"}`,
    r.companiesCreated && `${r.companiesCreated} new ${r.companiesCreated === 1 ? "company" : "companies"}`,
  ]
    .filter(Boolean)
    .join(", ");
  return { ok: true, message: `Logged ${r.logged} of ${r.fetched} new ${r.fetched === 1 ? "email" : "emails"}${extra ? ` (${extra})` : ""}` };
}

export async function togglePauseAction(): Promise<ActionState> {
  const { account } = await myAccount();
  if (!account) return { ok: false, message: "Connect Gmail first" };
  const status = account.status === "paused" ? "active" : "paused";
  await db.update(mailAccounts).set({ status }).where(eq(mailAccounts.id, account.id));
  revalidatePath(PATH);
  return { ok: true, message: status === "paused" ? "Paused. Nothing new is logged until you resume." : "Syncing again" };
}

/** Disconnect: revoke LimeCRM's access at Google and forget the token. Emails already logged stay. */
export async function disconnectAction(): Promise<ActionState> {
  const { account } = await myAccount();
  if (!account) return { ok: true, message: "Not connected" };
  try {
    await revokeToken(unseal(account.refreshTokenSealed, tokenKey()));
  } catch {
    // The token can't be read (key changed) or Google is unreachable: still forget it here.
  }
  await db.delete(mailAccounts).where(eq(mailAccounts.id, account.id));
  revalidatePath("/", "layout");
  return { ok: true, message: "Disconnected. Emails already logged stay on their records." };
}

/** Add a domain ("vendor.com") or an address to the never-log list. Anyone who can edit may add. */
export async function addExclusionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await getCurrentUser();
  const allowed = canWrite(user.role);
  if (!allowed.ok) return { ok: false, message: allowed.message };
  const raw = String(fd.get("value") ?? "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "");
  const value = raw.includes("@") ? normalizeEmail(raw) : /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(raw) ? raw : null;
  if (!value) return { ok: false, message: "Enter a domain (vendor.com) or an email address" };
  await db.insert(mailExclusions).values({ value, createdById: user.id }).onConflictDoNothing();
  revalidatePath(PATH);
  return { ok: true, message: `Mail with ${value} won't be logged` };
}

/** Removing is admin-only: someone added it for a reason. */
export async function removeExclusionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await getCurrentUser();
  if (user.role !== "admin") return { ok: false, message: "Only admins can remove entries" };
  await db.delete(mailExclusions).where(eq(mailExclusions.value, String(fd.get("value") ?? "")));
  revalidatePath(PATH);
  return { ok: true };
}
