"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/app/actions";
import { isPicklistKey, type PicklistKey } from "@/domain/fields";
import { getCurrentUser } from "@/server/auth";
import { addOption, mapOffListValue, moveOption, renameOption, restoreOption, retireOption, type FieldResult } from "@/server/fields";

/** Field values change every record that uses them, so only admins may edit them. */
async function run(fd: FormData, op: (key: PicklistKey) => Promise<FieldResult>): Promise<ActionState> {
  const user = await getCurrentUser();
  if (user.role !== "admin") return { ok: false, message: "Only admins can change field values" };
  const key = fd.get("field");
  if (!isPicklistKey(key)) return { ok: false, message: "Unknown field" };
  const res = await op(key);
  revalidatePath("/", "layout");
  return { ok: res.ok, message: res.message || undefined };
}

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");

export const addOptionAction = async (_: ActionState, fd: FormData) => run(fd, (k) => addOption(k, str(fd, "value")));
export const renameOptionAction = async (_: ActionState, fd: FormData) => run(fd, (k) => renameOption(k, str(fd, "value"), str(fd, "to")));
export const retireOptionAction = async (_: ActionState, fd: FormData) => run(fd, (k) => retireOption(k, str(fd, "value"), str(fd, "replaceWith") || null));
export const restoreOptionAction = async (_: ActionState, fd: FormData) => run(fd, (k) => restoreOption(k, str(fd, "value")));
export const moveOptionAction = async (_: ActionState, fd: FormData) => run(fd, (k) => moveOption(k, str(fd, "value"), fd.get("dir") === "up" ? -1 : 1));
export const mapValueAction = async (_: ActionState, fd: FormData) =>
  run(fd, (k) => mapOffListValue(k, str(fd, "value"), str(fd, "to") === "__clear" ? null : str(fd, "to")));
