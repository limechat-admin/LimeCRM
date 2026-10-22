"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/app/actions";
import { SUBSCRIPTION_TYPES } from "@/domain/campaigns";
import { verifyToken } from "@/domain/secret-box";
import { recordUnsubscribe, setPreference } from "@/server/campaigns";
import { tokenKey } from "@/server/gmail";

/** Public (no sign-in): the signed token is the authorisation, and it only covers its own address. */
export async function savePreferencesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const token = String(fd.get("token") ?? "");
  const data = verifyToken<{ e: string; c: string }>(token, tokenKey());
  if (!data?.e) return { ok: false, message: "This link isn't valid any more" };
  if (fd.get("all") === "1") {
    await recordUnsubscribe(data.e, data.c);
    revalidatePath(`/u/${token}`);
    return { ok: true, message: "You're unsubscribed from all LimeChat marketing email." };
  }
  const optedOut = SUBSCRIPTION_TYPES.map((t) => t.key).filter((k) => fd.get(k) !== "on");
  await setPreference(data.e, { unsubscribedAll: false, optedOut });
  revalidatePath(`/u/${token}`);
  return { ok: true, message: "Preferences saved." };
}
