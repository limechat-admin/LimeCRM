"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/app/actions";
import { getCurrentUser } from "@/server/auth";
import { createWebhookEndpoint, deleteWebhookEndpoint, pingWebhook, setWebhookActive } from "@/server/webhooks";

export type CreateEndpointState = { ok: boolean; message?: string; secret?: string; name?: string } | null;

const PATH = "/settings/webhooks";
const adminOnly = async () => {
  const user = await getCurrentUser();
  return user.role === "admin" ? user : null;
};

const createSchema = z.object({
  name: z.string().trim().min(1, "Name it after the app that receives it"),
  url: z.string().trim().min(1, "Enter the URL"),
  events: z.array(z.string()).min(1, "Pick at least one event"),
});

export async function createEndpointAction(_: CreateEndpointState, fd: FormData): Promise<CreateEndpointState> {
  const user = await adminOnly();
  if (!user) return { ok: false, message: "Only admins can manage webhooks" };
  const events = String(fd.get("events") ?? "")
    .split(",")
    .filter(Boolean);
  const parsed = createSchema.safeParse({ name: fd.get("name"), url: fd.get("url"), events });
  if (!parsed.success) return { ok: false, message: parsed.error.issues.map((i) => i.message).join("; ") };
  const res = await createWebhookEndpoint(parsed.data, user.id);
  if (!res.ok) return { ok: false, message: res.message };
  revalidatePath(PATH);
  return { ok: true, secret: res.secret, name: parsed.data.name };
}

const idOf = (fd: FormData) => z.string().uuid().safeParse(fd.get("endpointId"));

export async function toggleEndpointAction(_: ActionState, fd: FormData): Promise<ActionState> {
  if (!(await adminOnly())) return { ok: false, message: "Only admins can manage webhooks" };
  const id = idOf(fd);
  if (!id.success || !(await setWebhookActive(id.data, fd.get("active") === "true"))) return { ok: false, message: "Webhook not found" };
  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteEndpointAction(_: ActionState, fd: FormData): Promise<ActionState> {
  if (!(await adminOnly())) return { ok: false, message: "Only admins can manage webhooks" };
  const id = idOf(fd);
  if (!id.success || !(await deleteWebhookEndpoint(id.data))) return { ok: false, message: "Webhook not found" };
  revalidatePath(PATH);
  return { ok: true, message: "Webhook deleted" };
}

export async function pingEndpointAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await adminOnly();
  if (!user) return { ok: false, message: "Only admins can manage webhooks" };
  const id = idOf(fd);
  if (!id.success || !(await pingWebhook(id.data, user.id))) return { ok: false, message: "Webhook not found" };
  revalidatePath(PATH);
  return { ok: true, message: "Test sent" };
}
