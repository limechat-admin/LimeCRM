"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/app/actions";
import { canManageApiKeys, scopesFor } from "@/domain/api-keys";
import { createApiKey, revokeApiKey } from "@/server/api";
import { getCurrentUser } from "@/server/auth";

export type CreateKeyState = { ok: boolean; message?: string; key?: string; name?: string } | null;

const createSchema = z.object({
  name: z.string().trim().min(1, "Name the key after the app or person using it"),
  ownerId: z.string().uuid("Pick the user this key acts as"),
  access: z.enum(["read", "write"]),
});

/** Returns the new key in clear. This is the only time anyone sees it; only its hash is stored. */
export async function createApiKeyAction(_: CreateKeyState, fd: FormData): Promise<CreateKeyState> {
  const user = await getCurrentUser();
  const allowed = canManageApiKeys(user.role);
  if (!allowed.ok) return { ok: false, message: allowed.message };
  const parsed = createSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { ok: false, message: parsed.error.issues.map((i) => i.message).join("; ") };
  const { name, ownerId, access } = parsed.data;
  const { key } = await createApiKey({ name, ownerId, scopes: scopesFor(access) }, user.id);
  revalidatePath("/settings/api-keys");
  return { ok: true, key, name };
}

export async function revokeApiKeyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await getCurrentUser();
  const allowed = canManageApiKeys(user.role);
  if (!allowed.ok) return { ok: false, message: allowed.message };
  const id = z.string().uuid().safeParse(fd.get("keyId"));
  if (!id.success || !(await revokeApiKey(id.data, user.id))) return { ok: false, message: "Key not found or already revoked" };
  revalidatePath("/settings/api-keys");
  return { ok: true, message: "Key revoked" };
}
