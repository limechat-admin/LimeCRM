import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { after } from "next/server";
import { db, type Tx } from "@/db";
import { deals, notifications, onboardings, organizations, stages, users } from "@/db/schema";
import {
  churnedMessage,
  clientChannelIntro,
  clientChannelName,
  dailyDigestMessage,
  dealLostMessage,
  dealWonMessage,
  handedToCsMessage,
  MAX_ATTEMPTS,
  renewalDueMessage,
  retryDelayMinutes,
  type DealPayload,
  type DigestPayload,
  type NotificationKind,
  type OrgPayload,
  type RenewalPayload,
  type SlackMessage,
} from "@/domain/notify";
import { istDay } from "@/domain/work";
import { ensurePublicChannel, invite, postMessage, slackConfigured, SlackError, userIdByEmail } from "./slack";

export const appUrl = (path: string) => `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}${path}`;

type Enqueue = { kind: NotificationKind; target: string; orgId?: string | null; dedupeKey: string; payload: Record<string, unknown> };

/** Queue a notification inside the caller's transaction. A repeat dedupe key is ignored; returns whether it was new. */
export async function enqueue(tx: Tx, n: Enqueue): Promise<boolean> {
  const inserted = await tx.insert(notifications).values(n).onConflictDoNothing({ target: notifications.dedupeKey }).returning({ id: notifications.id });
  return inserted.length > 0;
}

// ---------- producers (called from transitions, inside their transaction) ----------

/** Won or lost: the deal's outcome for the deals channel; a first win also opens the client channel. */
export async function queueDealOutcome(tx: Tx, dealId: string, outcome: "won" | "lost") {
  const owner = alias(users, "owner");
  const sdr = alias(users, "sdr");
  const om = alias(users, "om");
  const [row] = await tx
    .select({ d: deals, stage: stages.name, org: organizations, owner: owner.name, ownerEmail: owner.email, sdr: sdr.name, omEmail: om.email, om: om.name })
    .from(deals)
    .innerJoin(stages, eq(stages.id, deals.stageId))
    .innerJoin(organizations, eq(organizations.id, deals.orgId))
    .leftJoin(owner, eq(owner.id, deals.ownerId))
    .leftJoin(sdr, eq(sdr.id, deals.sdrId))
    .leftJoin(om, eq(om.id, organizations.omId))
    .where(eq(deals.id, dealId));
  const payload: DealPayload = {
    url: appUrl(`/deals/${dealId}`),
    title: row.d.title,
    company: row.org.name,
    mrr: row.d.mrr,
    oneTimeFee: row.d.oneTimeFee,
    owner: row.owner,
    sdr: row.sdr,
    products: row.d.products,
    lostReason: row.d.lostReason,
    stage: row.stage,
  };
  // Include the close time so a deal reopened and won again announces again, but a double-submit doesn't.
  const closed = row.d.closedAt?.toISOString() ?? "";
  await enqueue(tx, { kind: outcome === "won" ? "deal_won" : "deal_lost", target: "deals", orgId: row.org.id, dedupeKey: `deal_${outcome}:${dealId}:${closed}`, payload });

  if (outcome === "won" && !row.org.clientChannel && row.d.requiresOnboarding) {
    await enqueue(tx, {
      kind: "client_channel",
      target: "create_channel",
      orgId: row.org.id,
      dedupeKey: `client_channel:${row.org.id}`,
      payload: { orgId: row.org.id, company: row.org.name, url: appUrl(`/companies/${row.org.id}`), ae: row.owner, aeEmail: row.ownerEmail, om: row.om, omEmail: row.omEmail },
    });
  }
}

async function orgPayload(tx: Tx, orgId: string): Promise<OrgPayload & { orgId: string }> {
  const csm = alias(users, "csm");
  const om = alias(users, "om");
  const [row] = await tx
    .select({ org: organizations, csm: csm.name, om: om.name })
    .from(organizations)
    .leftJoin(csm, eq(csm.id, organizations.csmId))
    .leftJoin(om, eq(om.id, organizations.omId))
    .where(eq(organizations.id, orgId));
  return {
    orgId,
    url: appUrl(`/companies/${orgId}`),
    company: row.org.name,
    mrr: row.org.contractedMrr,
    csm: row.csm,
    om: row.om,
    category: row.org.churnCategory,
    reason: row.org.churnReason,
    lastBillingDate: row.org.churnLastBillingDate,
  };
}

export async function queueHandedToCs(tx: Tx, onboardingId: string) {
  const [onb] = await tx.select().from(onboardings).where(eq(onboardings.id, onboardingId));
  const p = await orgPayload(tx, onb.orgId);
  await enqueue(tx, { kind: "handed_to_cs", target: "deals", orgId: onb.orgId, dedupeKey: `handed_to_cs:${onboardingId}`, payload: { ...p, nps: onb.nps } });
}

/** Churn alert. `mrrLost` is the contracted MRR just before churn (it's 0 afterwards). */
export async function queueChurned(tx: Tx, orgId: string, mrrLost: number) {
  const p = await orgPayload(tx, orgId);
  await enqueue(tx, { kind: "churned", target: "alerts", orgId, dedupeKey: `churned:${orgId}:${p.lastBillingDate ?? ""}`, payload: { ...p, mrr: mrrLost } });
}

// ---------- dispatch ----------

function render(kind: NotificationKind, payload: Record<string, unknown>): SlackMessage | null {
  switch (kind) {
    case "deal_won":
      return dealWonMessage(payload as DealPayload);
    case "deal_lost":
      return dealLostMessage(payload as DealPayload);
    case "handed_to_cs":
      return handedToCsMessage(payload as OrgPayload);
    case "churned":
      return churnedMessage(payload as OrgPayload);
    case "renewal_due":
      return renewalDueMessage(payload as RenewalPayload);
    case "daily_digest":
      return dailyDigestMessage(payload as DigestPayload);
    case "client_channel":
      return null;
  }
}

/** Where a channel target points, from env. Null means that channel isn't set up. */
function channelFor(target: string): string | null {
  if (target === "deals") return process.env.SLACK_DEALS_CHANNEL_ID || null;
  if (target === "alerts") return process.env.SLACK_ALERTS_CHANNEL_ID || null;
  return null;
}

async function send(n: typeof notifications.$inferSelect): Promise<"sent" | "skipped"> {
  if (n.kind === "client_channel") {
    const p = n.payload as { orgId: string; company: string; url: string; ae: string | null; aeEmail: string | null; om: string | null; omEmail: string | null };
    const channel = await ensurePublicChannel(clientChannelName(p.company));
    const people = await Promise.all([p.aeEmail, p.omEmail].filter((e): e is string => !!e).map(userIdByEmail));
    const metricBot = process.env.SLACK_METRIC_BOT_USER_ID;
    await invite(channel.id, [...people.filter((x): x is string => !!x), ...(metricBot ? [metricBot] : [])]);
    if (channel.created) {
      const intro = clientChannelIntro({ company: p.company, url: p.url, ae: p.ae, om: p.om });
      await postMessage(channel.id, intro.text, intro.blocks);
    }
    await db.update(organizations).set({ clientChannel: `#${channel.name}` }).where(and(eq(organizations.id, p.orgId), sql`${organizations.clientChannel} is null`));
    return "sent";
  }
  const msg = render(n.kind as NotificationKind, n.payload);
  if (!msg) return "skipped";
  let channel: string | null;
  if (n.target.startsWith("user:")) channel = await userIdByEmail(n.target.slice(5));
  else channel = channelFor(n.target);
  if (!channel) return "skipped";
  await postMessage(channel, msg.text, msg.blocks);
  return "sent";
}

/**
 * Send what's due. Without SLACK_BOT_TOKEN everything is marked skipped (and kept, so the
 * Notifications page shows what would have gone out). Failures retry with backoff.
 */
export async function dispatchPending(limit = 50) {
  const due = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.status, "pending"), lte(notifications.nextAttemptAt, new Date())))
    .orderBy(asc(notifications.createdAt))
    .limit(limit);
  const results = { sent: 0, skipped: 0, failed: 0 };
  for (const { id } of due) {
    // Claim it, so two dispatchers never send the same row.
    const [n] = await db
      .update(notifications)
      .set({ status: "sending", attempts: sql`${notifications.attempts} + 1` })
      .where(and(eq(notifications.id, id), eq(notifications.status, "pending")))
      .returning();
    if (!n) continue;
    if (!slackConfigured()) {
      await db.update(notifications).set({ status: "skipped", lastError: "Slack isn't configured (SLACK_BOT_TOKEN)" }).where(eq(notifications.id, id));
      results.skipped++;
      continue;
    }
    try {
      const outcome = await send(n);
      await db
        .update(notifications)
        .set(outcome === "sent" ? { status: "sent", sentAt: new Date(), lastError: null } : { status: "skipped", lastError: "No Slack channel or user for this target" })
        .where(eq(notifications.id, id));
      results[outcome]++;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const permanent = e instanceof SlackError && ["not_in_channel", "channel_not_found", "invalid_auth", "missing_scope", "restricted_action"].includes(e.code);
      const giveUp = permanent || n.attempts >= MAX_ATTEMPTS;
      await db
        .update(notifications)
        .set({
          status: giveUp ? "failed" : "pending",
          lastError: message,
          nextAttemptAt: new Date(Date.now() + retryDelayMinutes(n.attempts) * 60_000),
        })
        .where(eq(notifications.id, id));
      results.failed++;
    }
  }
  return results;
}

/** Try to send right after the current request. Safe to call outside a request (scripts): it does nothing. */
export function kickDispatch() {
  try {
    after(() => dispatchPending().catch((e) => console.error("notification dispatch failed", e)));
  } catch {
    // Not in a request (seed script, tests): the cron run picks these up.
  }
}

// ---------- scheduled (daily cron) ----------

const RENEWAL_WINDOWS = [30, 7, 1];

/** Renewal reminders 30, 7 and 1 day(s) out for live won contracts, to the alerts channel. */
export async function queueRenewals(now = new Date()) {
  const today = istDay(now);
  const owner = alias(users, "owner");
  const rows = await db
    .select({ d: deals, org: organizations.name, owner: owner.name })
    .from(deals)
    .innerJoin(organizations, eq(organizations.id, deals.orgId))
    .leftJoin(owner, eq(owner.id, deals.ownerId))
    .where(
      and(
        eq(deals.status, "won"),
        sql`${deals.endedAt} is null`,
        sql`${organizations.lifecycle} <> 'churned'`,
        inArray(sql`(${deals.contractRenewal} - ${today}::date)`, RENEWAL_WINDOWS),
      ),
    );
  let queued = 0;
  for (const r of rows) {
    const daysLeft = Math.round((new Date(`${r.d.contractRenewal}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86_400_000);
    const payload: RenewalPayload = { url: appUrl(`/deals/${r.d.id}`), company: r.org, deal: r.d.title, renewalDate: r.d.contractRenewal!, daysLeft, mrr: r.d.mrr, owner: r.owner };
    if (await db.transaction((tx) => enqueue(tx, { kind: "renewal_due", target: "alerts", orgId: r.d.orgId, dedupeKey: `renewal:${r.d.id}:${daysLeft}`, payload }))) queued++;
  }
  return queued;
}

/** One morning DM per active user who has overdue/today tasks or quiet deals. */
export async function queueDigests(getWork: (userId: string) => Promise<{ tasks: { overdue: DigestRow[]; today: DigestRow[] }; stale: StaleRow[] }>, now = new Date()) {
  const people = await db.select().from(users).where(eq(users.isActive, true));
  const today = istDay(now);
  let queued = 0;
  for (const u of people) {
    const work = await getWork(u.id);
    const item = (t: DigestRow) => ({
      label: t.subject,
      url: appUrl(t.dealId ? `/deals/${t.dealId}` : t.contactId ? `/leads/${t.contactId}` : t.orgId ? `/companies/${t.orgId}` : "/work"),
      detail: t.dealTitle ?? t.contactName ?? t.orgName ?? "",
    });
    const payload: DigestPayload = {
      name: u.name,
      overdue: work.tasks.overdue.map(item),
      today: work.tasks.today.map(item),
      stale: work.stale.map((d) => ({ label: d.title, url: appUrl(`/deals/${d.id}`), detail: d.idleDays === null ? "never touched" : `${d.idleDays} days quiet` })),
      workUrl: appUrl("/work"),
    };
    if (!dailyDigestMessage(payload)) continue;
    if (await db.transaction((tx) => enqueue(tx, { kind: "daily_digest", target: `user:${u.email}`, dedupeKey: `digest:${u.id}:${today}`, payload }))) queued++;
  }
  return queued;
}

type DigestRow = { subject: string; dealId: string | null; dealTitle: string | null; contactId: string | null; contactName: string | null; orgId: string | null; orgName: string | null };
type StaleRow = { id: string; title: string; idleDays: number | null };
