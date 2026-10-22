/**
 * Campaign sending: evaluate a list, snapshot its recipients when a campaign starts (skipping anyone
 * unsubscribed, opted out of the type, bounced or complained), send in batches through Postmark,
 * and record what Postmark reports back (deliveries, opens, clicks, bounces, complaints,
 * unsubscribes). Runs from the dispatch cron, and right after "Send now".
 */
import { and, asc, eq, inArray, isNotNull, lte, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { after } from "next/server";
import { db } from "@/db";
import { campaignRecipients, campaigns, contacts, emailLists, emailPreferences, organizations, users, type Campaign } from "@/db/schema";
import {
  blockedReason,
  blocksSchema,
  firstName,
  isSubscriptionType,
  listFiltersSchema,
  renderEmail,
  SUBSCRIPTION_TYPES,
  type CampaignCounts,
  type ListFilters,
  type Preference,
  type SubscriptionType,
} from "@/domain/campaigns";
import { emailDomain } from "@/domain/mail";
import { signToken } from "@/domain/secret-box";
import { tokenKey, appUrl } from "./gmail";
import { BATCH_SIZE, campaignSetupProblems, postmarkDriver, postmarkStream, sendingDomain, type MailDriver, type OutgoingEmail } from "./postmark";

// ---------- lists ----------

export type ListMember = { contactId: string; name: string; email: string; company: string | null; aeName: string | null };

/** Everyone a list's filters match who has an email address, one row per address. */
export async function listMembers(filters: ListFilters, limit?: number): Promise<{ rows: ListMember[]; total: number }> {
  const ae = alias(users, "ae");
  const conds: SQL[] = [isNotNull(contacts.email), sql`${contacts.email} <> ''`];
  if (filters.audience === "leads") conds.push(isNotNull(contacts.leadStatus));
  if (filters.leadStatuses.length) conds.push(inArray(contacts.leadStatus, filters.leadStatuses));
  if (filters.sdrIds.length) conds.push(inArray(contacts.sdrId, filters.sdrIds));
  if (filters.ownerIds.length) conds.push(sql`coalesce(${contacts.ownerId}, ${organizations.aeId}) in ${filters.ownerIds}`);
  if (filters.sources.length) conds.push(inArray(contacts.source, filters.sources));
  if (filters.products.length) conds.push(sql`${contacts.productInterest} && ${sql.param(filters.products)}::text[]`);
  if (filters.lifecycles.length) conds.push(sql`${organizations.lifecycle}::text in ${filters.lifecycles}`);
  if (filters.segments.length) conds.push(sql`${organizations.segment}::text in ${filters.segments}`);
  if (filters.industries.length) conds.push(inArray(organizations.industry, filters.industries));
  if (filters.trafficBands.length) conds.push(inArray(organizations.websiteTrafficRange, filters.trafficBands));
  if (filters.reconnectDueBy) conds.push(lte(organizations.reconnectOn, filters.reconnectDueBy));
  const where = and(...conds);
  const base = db
    .selectDistinctOn([sql`lower(${contacts.email})`], {
      contactId: contacts.id,
      name: contacts.name,
      email: sql<string>`lower(${contacts.email})`,
      company: organizations.name,
      aeName: ae.name,
    })
    .from(contacts)
    .leftJoin(organizations, eq(organizations.id, contacts.orgId))
    .leftJoin(ae, eq(ae.id, sql`coalesce(${contacts.ownerId}, ${organizations.aeId})`))
    .where(where)
    .orderBy(sql`lower(${contacts.email})`, asc(contacts.createdAt));
  const rows = limit ? await base.limit(limit) : await base;
  const [{ n }] = await db
    .select({ n: sql<number>`count(distinct lower(${contacts.email}))::int` })
    .from(contacts)
    .leftJoin(organizations, eq(organizations.id, contacts.orgId))
    .where(where);
  return { rows, total: n };
}

export async function getList(id: string) {
  const [list] = await db.select().from(emailLists).where(eq(emailLists.id, id));
  return list ? { ...list, filters: listFiltersSchema.parse(list.filters) } : null;
}

// ---------- preferences ----------

export async function preferencesFor(emails: string[]): Promise<Map<string, NonNullable<Preference>>> {
  const out = new Map<string, NonNullable<Preference>>();
  for (let i = 0; i < emails.length; i += 5000) {
    const rows = await db
      .select()
      .from(emailPreferences)
      .where(inArray(emailPreferences.email, emails.slice(i, i + 5000)));
    for (const r of rows) out.set(r.email, { unsubscribedAll: r.unsubscribedAll, optedOut: r.optedOut, suppressed: r.suppressed });
  }
  return out;
}

export async function setPreference(email: string, patch: Partial<{ unsubscribedAll: boolean; optedOut: string[]; suppressed: string | null }>) {
  const e = email.toLowerCase();
  await db
    .insert(emailPreferences)
    .values({ email: e, unsubscribedAll: patch.unsubscribedAll ?? false, optedOut: patch.optedOut ?? [], suppressed: patch.suppressed ?? null })
    .onConflictDoUpdate({ target: emailPreferences.email, set: patch });
}

/** Unsubscribe links and the List-Unsubscribe header, signed so they work without signing in. */
export function unsubscribeLinks(email: string, campaignId: string) {
  const token = signToken({ e: email.toLowerCase(), c: campaignId }, tokenKey());
  return { token, preferences: `${appUrl()}/u/${token}`, unsubscribe: `${appUrl()}/u/${token}?all=1`, oneClick: `${appUrl()}/api/email/unsubscribe/${token}` };
}

// ---------- validation and start ----------

export type StartResult = { ok: true; queued: number; skipped: number } | { ok: false; message: string };

/** What stops this campaign from going out, in plain words (empty when it's ready). */
export async function campaignProblems(c: Campaign): Promise<string[]> {
  const out = campaignSetupProblems().map((p) => `Server setup: ${p}`);
  if (!c.listId) out.push("Pick a list");
  if (!c.subject.trim()) out.push("Write a subject");
  const blocks = blocksSchema.safeParse(c.blocks);
  if (!blocks.success || !blocks.data.length) out.push("Add some content");
  if (!isSubscriptionType(c.subscriptionType)) out.push("Pick a subscription type");
  const domain = sendingDomain();
  if (domain && emailDomain(c.fromEmail) !== domain) out.push(`Send from an address at ${domain} (the domain verified in Postmark)`);
  return out;
}

/** Snapshot the list into recipients (skipping the opted-out) and mark the campaign sending. */
export async function startCampaign(campaignId: string, opts: { ignoreSetup?: boolean } = {}): Promise<StartResult> {
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!c) return { ok: false, message: "Campaign not found" };
  if (!["draft", "scheduled"].includes(c.status)) return { ok: false, message: `This campaign is already ${c.status}` };
  const problems = (await campaignProblems(c)).filter((p) => !(opts.ignoreSetup && p.startsWith("Server setup")));
  if (problems.length) return { ok: false, message: problems.join("; ") };
  const list = await getList(c.listId!);
  if (!list) return { ok: false, message: "The list was deleted" };
  const { rows } = await listMembers(list.filters);
  if (!rows.length) return { ok: false, message: "The list has nobody with an email address" };
  const prefs = await preferencesFor(rows.map((r) => r.email));
  const type = c.subscriptionType as SubscriptionType;
  const values = rows.map((r) => {
    const reason = blockedReason(prefs.get(r.email), type);
    return {
      campaignId: c.id,
      contactId: r.contactId,
      email: r.email,
      vars: { first_name: firstName(r.name), name: r.name, company: r.company ?? "", email: r.email, ae_name: r.aeName ?? "", sender_name: c.fromName },
      status: reason ? "skipped" : "queued",
      skipReason: reason,
    };
  });
  await db.transaction(async (tx) => {
    for (let i = 0; i < values.length; i += 1000)
      await tx
        .insert(campaignRecipients)
        .values(values.slice(i, i + 1000))
        .onConflictDoNothing();
    await tx.update(campaigns).set({ status: "sending", startedAt: new Date() }).where(eq(campaigns.id, c.id));
  });
  kickCampaigns();
  return { ok: true, queued: values.filter((v) => v.status === "queued").length, skipped: values.filter((v) => v.status === "skipped").length };
}

// ---------- sending ----------

export const logoUrl = () => `${appUrl()}/brand/limechat-email-logo.png`;

export function messageFor(c: Campaign, r: { id: string; email: string; vars: Record<string, string> }): OutgoingEmail {
  const links = unsubscribeLinks(r.email, c.id);
  const typeLabel = SUBSCRIPTION_TYPES.find((t) => t.key === c.subscriptionType)?.label ?? "LimeChat updates";
  const rendered = renderEmail({ subject: c.subject, preheader: c.preheader, blocks: blocksSchema.parse(c.blocks), logoUrl: logoUrl() }, r.vars, {
    companyLine: "LimeChat",
    address: process.env.MAIL_POSTAL_ADDRESS || "",
    unsubscribeUrl: links.unsubscribe,
    preferencesUrl: links.preferences,
    reason: `You're getting this because you're subscribed to ${typeLabel.toLowerCase()} from LimeChat.`,
  });
  return {
    From: `"${c.fromName.replace(/"/g, "")}" <${c.fromEmail}>`,
    To: r.email,
    ...(c.replyTo ? { ReplyTo: c.replyTo } : {}),
    Subject: rendered.subject,
    HtmlBody: rendered.html,
    TextBody: rendered.text,
    MessageStream: postmarkStream(),
    Tag: c.name.slice(0, 1000),
    TrackOpens: true,
    TrackLinks: "HtmlAndText",
    Headers: [
      { Name: "List-Unsubscribe", Value: `<${links.oneClick}>` },
      { Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" },
    ],
    Metadata: { campaign_id: c.id, recipient_id: r.id },
  };
}

/** Start scheduled campaigns that are due, then send queued recipients in batches. */
export async function dispatchCampaigns(driver: MailDriver = postmarkDriver(), maxBatches = 4) {
  const due = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(eq(campaigns.status, "scheduled"), lte(campaigns.scheduledAt, sql`now()`)));
  for (const d of due) await startCampaign(d.id);

  const result = { sent: 0, failed: 0, campaignsFinished: 0 };
  const sending = await db.select().from(campaigns).where(eq(campaigns.status, "sending"));
  for (const c of sending) {
    for (let b = 0; b < maxBatches; b++) {
      // Claim a batch, so two dispatchers never send the same recipient.
      const batch = await db.execute<{ id: string; email: string; vars: Record<string, string> }>(sql`
        update ${campaignRecipients} set status = 'sending'
        where id in (select id from ${campaignRecipients} where campaign_id = ${c.id} and status = 'queued' limit ${BATCH_SIZE} for update skip locked)
        returning id, email, vars`);
      const rows = [...batch];
      if (!rows.length) break;
      let results;
      try {
        results = await driver.sendBatch(rows.map((r) => messageFor(c, r)));
      } catch (e) {
        // The whole batch failed (network, auth): put it back for the next run.
        await db
          .update(campaignRecipients)
          .set({ status: "queued", error: e instanceof Error ? e.message : String(e) })
          .where(
            inArray(
              campaignRecipients.id,
              rows.map((r) => r.id),
            ),
          );
        result.failed += rows.length;
        break;
      }
      for (const [i, r] of rows.entries()) {
        const res = results[i];
        if (res?.ErrorCode === 0) {
          await db
            .update(campaignRecipients)
            .set({ status: "sent", sentAt: new Date(), postmarkMessageId: res.MessageID, error: null })
            .where(eq(campaignRecipients.id, r.id));
          result.sent++;
        } else if (res?.ErrorCode === 406) {
          // Postmark already suppresses this address (earlier bounce or complaint): mirror it here.
          await db.update(campaignRecipients).set({ status: "skipped", skipReason: "Suppressed by Postmark" }).where(eq(campaignRecipients.id, r.id));
          await setPreference(r.email, { suppressed: "hard_bounce" });
        } else {
          await db
            .update(campaignRecipients)
            .set({ status: "failed", error: res ? `${res.ErrorCode}: ${res.Message}` : "No result from Postmark" })
            .where(eq(campaignRecipients.id, r.id));
          result.failed++;
        }
      }
    }
    const [{ left }] = await db
      .select({ left: sql<number>`count(*)::int` })
      .from(campaignRecipients)
      .where(and(eq(campaignRecipients.campaignId, c.id), inArray(campaignRecipients.status, ["queued", "sending"])));
    if (left === 0) {
      await db.update(campaigns).set({ status: "sent", sentAt: new Date() }).where(eq(campaigns.id, c.id));
      result.campaignsFinished++;
    }
  }
  return result;
}

/** Send right after the current request; outside one, the cron picks it up. */
export function kickCampaigns() {
  if (campaignSetupProblems().length) return;
  try {
    after(() => dispatchCampaigns().catch((e) => console.error("campaign dispatch failed", e)));
  } catch {
    // Not in a request.
  }
}

// ---------- what Postmark reports back ----------

type PostmarkEvent = {
  RecordType: string;
  MessageID?: string;
  Recipient?: string;
  Email?: string;
  Type?: string;
  SuppressSending?: boolean;
  Metadata?: Record<string, string>;
  ReceivedAt?: string;
  DeliveredAt?: string;
  BouncedAt?: string;
};

const HARD_BOUNCES = new Set(["HardBounce", "BadEmailAddress", "ManuallyDeactivated", "Blocked"]);

/** Apply one Postmark webhook event. Unknown events and messages are ignored (Postmark also sends transactional ones). */
export async function handlePostmarkEvent(e: PostmarkEvent) {
  const recipientId = e.Metadata?.recipient_id;
  const where = e.MessageID ? eq(campaignRecipients.postmarkMessageId, e.MessageID) : recipientId ? eq(campaignRecipients.id, recipientId) : null;
  const [r] = where ? await db.select().from(campaignRecipients).where(where).limit(1) : [];
  const email = (e.Recipient ?? e.Email ?? r?.email ?? "").toLowerCase();
  const at = new Date(e.ReceivedAt ?? e.DeliveredAt ?? e.BouncedAt ?? Date.now());
  // Inside coalesce() the driver can't infer a Date's type, so it goes in as a typed ISO string.
  const atSql = sql`${at.toISOString()}::timestamptz`;
  switch (e.RecordType) {
    case "Delivery":
      if (r) await db.update(campaignRecipients).set({ deliveredAt: at }).where(eq(campaignRecipients.id, r.id));
      return "delivery";
    case "Open":
      if (r)
        await db
          .update(campaignRecipients)
          .set({ opens: sql`${campaignRecipients.opens} + 1`, openedAt: sql`coalesce(${campaignRecipients.openedAt}, ${atSql})` })
          .where(eq(campaignRecipients.id, r.id));
      return "open";
    case "Click":
      // A click proves an open even when images were blocked.
      if (r)
        await db
          .update(campaignRecipients)
          .set({
            clicks: sql`${campaignRecipients.clicks} + 1`,
            clickedAt: sql`coalesce(${campaignRecipients.clickedAt}, ${atSql})`,
            openedAt: sql`coalesce(${campaignRecipients.openedAt}, ${atSql})`,
          })
          .where(eq(campaignRecipients.id, r.id));
      return "click";
    case "Bounce":
      if (r)
        await db
          .update(campaignRecipients)
          .set({ bouncedAt: at, bounceType: e.Type ?? null })
          .where(eq(campaignRecipients.id, r.id));
      if (email && HARD_BOUNCES.has(e.Type ?? "")) await setPreference(email, { suppressed: "hard_bounce" });
      return "bounce";
    case "SpamComplaint":
      if (r) await db.update(campaignRecipients).set({ complainedAt: at }).where(eq(campaignRecipients.id, r.id));
      if (email) await setPreference(email, { suppressed: "spam_complaint", unsubscribedAll: true });
      return "complaint";
    case "SubscriptionChange":
      if (email && e.SuppressSending) {
        await setPreference(email, { unsubscribedAll: true });
        if (r) await db.update(campaignRecipients).set({ unsubscribedAt: at }).where(eq(campaignRecipients.id, r.id));
      }
      return "subscription";
    default:
      return "ignored";
  }
}

/** Mark an unsubscribe from a campaign's link on that campaign's results, too. */
export async function recordUnsubscribe(email: string, campaignId: string | undefined) {
  await setPreference(email, { unsubscribedAll: true });
  if (campaignId) {
    await db
      .update(campaignRecipients)
      .set({ unsubscribedAt: sql`coalesce(${campaignRecipients.unsubscribedAt}, now())` })
      .where(and(eq(campaignRecipients.campaignId, campaignId), eq(campaignRecipients.email, email.toLowerCase())));
  }
}

// ---------- results ----------

export async function campaignCounts(campaignId: string): Promise<CampaignCounts> {
  const [c] = await db
    .select({
      recipients: sql<number>`count(*)::int`,
      sent: sql<number>`count(*) filter (where status = 'sent')::int`,
      delivered: sql<number>`count(delivered_at)::int`,
      opened: sql<number>`count(opened_at)::int`,
      clicked: sql<number>`count(clicked_at)::int`,
      bounced: sql<number>`count(bounced_at)::int`,
      complained: sql<number>`count(complained_at)::int`,
      unsubscribed: sql<number>`count(unsubscribed_at)::int`,
      skipped: sql<number>`count(*) filter (where status = 'skipped')::int`,
      failed: sql<number>`count(*) filter (where status = 'failed')::int`,
    })
    .from(campaignRecipients)
    .where(eq(campaignRecipients.campaignId, campaignId));
  return c;
}
