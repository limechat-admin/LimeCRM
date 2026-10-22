"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/app/actions";
import { db } from "@/db";
import { campaignRecipients, campaigns, emailLists, type User } from "@/db/schema";
import { blocksSchema, firstName, isSubscriptionType, listFiltersSchema, STARTER_BLOCKS } from "@/domain/campaigns";
import { canWrite } from "@/domain/permissions";
import { getCurrentUser } from "@/server/auth";
import { campaignProblems, messageFor, startCampaign } from "@/server/campaigns";
import { campaignSetupProblems, postmarkDriver, sendingDomain } from "@/server/postmark";

/** Drafting is open to anyone who can edit; sending to a list is Sales and Admin only. */
const canSend = (u: User) => u.role === "admin" || u.role === "sales";

async function editable(id: string) {
  const user = await getCurrentUser();
  if (!canWrite(user.role).ok) return { error: "Viewers can't edit campaigns" } as const;
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  if (!c) return { error: "Campaign not found" } as const;
  return { user, c } as const;
}

export async function createCampaignAction() {
  const user = await getCurrentUser();
  if (!canWrite(user.role).ok) return;
  const domain = sendingDomain();
  const ownDomain = user.email.split("@")[1];
  const [c] = await db
    .insert(campaigns)
    .values({
      name: "Untitled campaign",
      fromName: `${firstName(user.name)} from LimeChat`,
      fromEmail: !domain || ownDomain === domain ? user.email : `hello@${domain}`,
      replyTo: user.email,
      blocks: STARTER_BLOCKS,
      createdById: user.id,
    })
    .returning({ id: campaigns.id });
  redirect(`/campaigns/${c.id}`);
}

const contentSchema = z.object({
  name: z.string().trim().min(1, "Name the campaign").max(120),
  listId: z.string().uuid().nullable(),
  subscriptionType: z.string().refine(isSubscriptionType, "Pick a subscription type"),
  fromName: z.string().trim().min(1, "Add a sender name").max(80),
  fromEmail: z.email("Sender email isn't valid"),
  replyTo: z
    .email("Reply-to isn't valid")
    .nullable()
    .or(z.literal("").transform(() => null)),
  subject: z.string().max(200),
  preheader: z.string().max(200).nullable(),
  blocks: blocksSchema,
});
export type CampaignContent = z.infer<typeof contentSchema>;

export async function saveCampaignAction(id: string, content: CampaignContent): Promise<ActionState> {
  const e = await editable(id);
  if ("error" in e) return { ok: false, message: e.error };
  if (!["draft", "scheduled"].includes(e.c.status)) return { ok: false, message: "A campaign that's sending or sent can't be changed. Duplicate it instead." };
  const parsed = contentSchema.safeParse(content);
  if (!parsed.success) return { ok: false, message: parsed.error.issues.map((i) => i.message).join("; ") };
  await db.update(campaigns).set(parsed.data).where(eq(campaigns.id, id));
  revalidatePath(`/campaigns/${id}`);
  return { ok: true, message: "Saved" };
}

/** Send the saved version to yourself, personalised with your own details. */
export async function sendTestAction(id: string): Promise<ActionState> {
  const e = await editable(id);
  if ("error" in e) return { ok: false, message: e.error };
  const setup = campaignSetupProblems();
  if (setup.length) return { ok: false, message: `Postmark isn't set up on this server: ${setup.join(", ")}` };
  const msg = messageFor(e.c, {
    id: "test",
    email: e.user.email,
    vars: {
      first_name: firstName(e.user.name),
      name: e.user.name,
      company: "Your company",
      email: e.user.email,
      ae_name: e.user.name,
      sender_name: e.c.fromName,
    },
  });
  const [res] = await postmarkDriver().sendBatch([{ ...msg, Subject: `[Test] ${msg.Subject}` }]);
  return res?.ErrorCode === 0 ? { ok: true, message: `Test sent to ${e.user.email}` } : { ok: false, message: res?.Message ?? "Postmark didn't accept it" };
}

export async function sendNowAction(id: string): Promise<ActionState> {
  const e = await editable(id);
  if ("error" in e) return { ok: false, message: e.error };
  if (!canSend(e.user)) return { ok: false, message: "Only Sales and Admin can send campaigns" };
  const res = await startCampaign(id);
  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${id}`);
  return res.ok
    ? { ok: true, message: `Sending to ${res.queued.toLocaleString("en-IN")} people${res.skipped ? ` (${res.skipped} skipped: unsubscribed or bounced)` : ""}` }
    : { ok: false, message: res.message };
}

export async function scheduleAction(id: string, at: string | null): Promise<ActionState> {
  const e = await editable(id);
  if ("error" in e) return { ok: false, message: e.error };
  if (!canSend(e.user)) return { ok: false, message: "Only Sales and Admin can schedule campaigns" };
  if (!at) {
    await db.update(campaigns).set({ status: "draft", scheduledAt: null }).where(eq(campaigns.id, id));
    revalidatePath(`/campaigns/${id}`);
    return { ok: true, message: "Back to draft" };
  }
  const when = new Date(at);
  if (Number.isNaN(when.getTime()) || when.getTime() < Date.now() + 60_000) return { ok: false, message: "Pick a time at least a minute from now" };
  const problems = await campaignProblems(e.c);
  if (problems.length) return { ok: false, message: problems.join("; ") };
  await db.update(campaigns).set({ status: "scheduled", scheduledAt: when }).where(eq(campaigns.id, id));
  revalidatePath(`/campaigns/${id}`);
  return { ok: true, message: `Scheduled for ${when.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}` };
}

export async function duplicateCampaignAction(fd: FormData) {
  const id = String(fd.get("id") ?? "");
  const e = await editable(id);
  if ("error" in e) return;
  const { name, listId, subscriptionType, fromName, fromEmail, replyTo, subject, preheader, blocks } = e.c;
  const [copy] = await db
    .insert(campaigns)
    .values({ name: `${name} (copy)`, listId, subscriptionType, fromName, fromEmail, replyTo, subject, preheader, blocks, createdById: e.user.id })
    .returning({ id: campaigns.id });
  redirect(`/campaigns/${copy.id}`);
}

export async function deleteDraftAction(fd: FormData) {
  const id = String(fd.get("id") ?? "");
  const e = await editable(id);
  if ("error" in e || e.c.status !== "draft") return;
  await db.delete(campaignRecipients).where(eq(campaignRecipients.campaignId, id));
  await db.delete(campaigns).where(eq(campaigns.id, id));
  revalidatePath("/campaigns");
  redirect("/campaigns");
}

// ---------- lists ----------

export async function saveListAction(id: string | null, name: string, filters: unknown): Promise<ActionState & { id?: string }> {
  const user = await getCurrentUser();
  if (!canWrite(user.role).ok) return { ok: false, message: "Viewers can't edit lists" };
  const f = listFiltersSchema.safeParse(filters);
  if (!f.success || !name.trim()) return { ok: false, message: !name.trim() ? "Name the list" : "Those filters aren't valid" };
  if (id) {
    await db.update(emailLists).set({ name: name.trim(), filters: f.data }).where(eq(emailLists.id, id));
    revalidatePath(`/campaigns/lists/${id}`);
    return { ok: true, message: "Saved", id };
  }
  const [l] = await db.insert(emailLists).values({ name: name.trim(), filters: f.data, createdById: user.id }).returning({ id: emailLists.id });
  revalidatePath("/campaigns/lists");
  return { ok: true, message: "List created", id: l.id };
}

export async function deleteListAction(fd: FormData) {
  const user = await getCurrentUser();
  if (!canWrite(user.role).ok) return;
  await db.delete(emailLists).where(eq(emailLists.id, String(fd.get("id") ?? "")));
  revalidatePath("/campaigns/lists");
  redirect("/campaigns/lists");
}
