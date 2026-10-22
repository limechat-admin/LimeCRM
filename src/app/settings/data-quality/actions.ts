"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/app/actions";
import { getCurrentUser } from "@/server/auth";
import { applyFormatFixes, mergeCompanies, mergeContacts } from "@/server/data-quality";

async function admin() {
  const user = await getCurrentUser();
  return user.role === "admin" ? user : null;
}

export async function tidyFormatsAction(): Promise<ActionState> {
  const user = await admin();
  if (!user) return { ok: false, message: "Only admins can do this" };
  const n = await applyFormatFixes(user.id);
  revalidatePath("/", "layout");
  return { ok: true, message: n ? `Tidied ${n} ${n === 1 ? "value" : "values"}` : "Nothing to tidy" };
}

const pair = z.object({ keepId: z.string().uuid(), dropId: z.string().uuid() });

export async function mergeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await admin();
  if (!user) return { ok: false, message: "Only admins can merge records" };
  const ids = pair.safeParse({ keepId: fd.get("keepId"), dropId: fd.get("dropId") });
  if (!ids.success) return { ok: false, message: "Pick the record to keep" };
  const res =
    fd.get("kind") === "contact"
      ? await mergeContacts(ids.data.keepId, ids.data.dropId, user.id)
      : await mergeCompanies(ids.data.keepId, ids.data.dropId, user.id);
  revalidatePath("/", "layout");
  return res;
}
