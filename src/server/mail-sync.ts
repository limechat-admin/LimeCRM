/**
 * Gmail → LimeCRM. For each connected mailbox: fetch new messages (Gmail history, or a date search
 * on first sync), decide what to log (src/domain/mail.ts), find or create the people and company,
 * and log an "Email" activity on the contact, company and its open deal. Runs from the dispatch
 * cron every few minutes, and on "Sync now".
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { activities, contacts, deals, emailMessages, mailAccounts, mailExclusions, organizations, type MailAccount } from "@/db/schema";
import { normalizeEmail, tidyName } from "@/domain/fields";
import {
  activitySubject,
  companyNameFromDomain,
  contactNameFor,
  emailDomain,
  isPersonalDomain,
  planMessage,
  trimSnippet,
  type Address,
  type MailPlan,
} from "@/domain/mail";
import { ALLOWED_EMAIL_DOMAIN } from "@/domain/permissions";
import { unseal } from "@/domain/secret-box";
import { recordEvent } from "./events";
import { GmailError, gmailClient, gmailConfigured, tokenKey, type GmailClient, type GmailMessage } from "./gmail";

/** How far back the first sync looks. */
export const BACKFILL_DAYS = 30;
/** Messages handled per mailbox per run; the rest wait for the next run. */
const PER_RUN = 300;

type Logged = Extract<MailPlan, { log: true }>;
export type SyncResult = {
  account: string;
  fetched: number;
  logged: number;
  skipped: Record<string, number>;
  contactsCreated: number;
  companiesCreated: number;
  error?: string;
};

async function findOrCreateCompany(tx: Tx, domain: string, actorId: string, created: { companies: number }) {
  const [byDomain] = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.website, domain)).limit(1);
  if (byDomain) return byDomain.id;
  const [org] = await tx
    .insert(organizations)
    .values({ name: companyNameFromDomain(domain), website: domain })
    .returning({ id: organizations.id, name: organizations.name });
  await recordEvent(tx, {
    entityType: "organization",
    entityId: org.id,
    orgId: org.id,
    actorId,
    action: "created",
    data: { name: org.name, via: "email", domain },
  });
  created.companies++;
  return org.id;
}

/**
 * Log one message. Outbound: unknown recipients become contacts (and their company, by domain).
 * Inbound: logged only when the sender is already a contact.
 */
export async function logMessage(account: Pick<MailAccount, "id" | "userId">, msg: GmailMessage, plan: Logged) {
  const messageId = plan.messageId ?? `gmail:${msg.id}`;
  return db.transaction(async (tx) => {
    const [dupe] = await tx.select({ id: emailMessages.id }).from(emailMessages).where(eq(emailMessages.messageId, messageId)).limit(1);
    if (dupe) return { outcome: "duplicate" as const };

    const created = { contacts: 0, companies: 0 };
    const people: { address: Address; id: string; orgId: string | null }[] = [];
    for (const a of plan.externals) {
      const email = normalizeEmail(a.email) ?? a.email;
      const [known] = await tx
        .select({ id: contacts.id, orgId: contacts.orgId })
        .from(contacts)
        .where(sql`lower(${contacts.email}) = ${email}`)
        .limit(1);
      if (known) {
        people.push({ address: a, ...known });
        continue;
      }
      if (plan.direction !== "outbound") continue;
      const domain = emailDomain(email);
      const orgId = isPersonalDomain(domain) ? null : await findOrCreateCompany(tx, domain, account.userId, created);
      const [c] = await tx
        .insert(contacts)
        .values({ name: tidyName(contactNameFor(a)), email, orgId, ownerId: account.userId })
        .returning({ id: contacts.id });
      await recordEvent(tx, {
        entityType: "contact",
        entityId: c.id,
        orgId,
        actorId: account.userId,
        action: "created",
        data: { name: contactNameFor(a), via: "email" },
      });
      created.contacts++;
      people.push({ address: a, id: c.id, orgId });
    }
    if (plan.direction === "inbound" && !people.some((p) => p.address.email === plan.from.email)) return { outcome: "unknown_sender" as const };
    if (!people.length) return { outcome: "unknown_sender" as const };

    const primary = (plan.direction === "inbound" ? people.find((p) => p.address.email === plan.from.email) : people[0])!;
    const orgId = primary.orgId ?? people.find((p) => p.orgId)?.orgId ?? null;
    const [openDeal] = orgId
      ? await tx
          .select({ id: deals.id })
          .from(deals)
          .where(and(eq(deals.orgId, orgId), eq(deals.status, "open")))
          .orderBy(desc(deals.updatedAt))
          .limit(1)
      : [];
    const snippet = trimSnippet(msg.snippet);
    const [activity] = await tx
      .insert(activities)
      .values({
        type: "email",
        subject: activitySubject(plan),
        body: snippet || null,
        ownerId: account.userId,
        orgId,
        contactId: primary.id,
        dealId: openDeal?.id ?? null,
        // Dated when it was sent, so "last touch" and stale-deal checks see the real date.
        createdAt: plan.sentAt,
        completedAt: plan.sentAt,
        createdById: account.userId,
      })
      .returning({ id: activities.id });
    await tx.insert(emailMessages).values({
      messageId,
      gmailId: msg.id,
      threadId: msg.threadId,
      accountId: account.id,
      direction: plan.direction,
      subject: plan.subject,
      snippet,
      fromEmail: plan.from.email,
      participants: plan.externals,
      sentAt: plan.sentAt,
      activityId: activity.id,
      orgId,
      contactId: primary.id,
    });
    return { outcome: "logged" as const, ...created };
  });
}

/** Sync one mailbox. Never throws: failures are recorded on the account. */
export async function syncAccount(account: MailAccount, client?: GmailClient, now = new Date()): Promise<SyncResult> {
  const result: SyncResult = { account: account.email, fetched: 0, logged: 0, skipped: {}, contactsCreated: 0, companiesCreated: 0 };
  try {
    if (!client && !gmailConfigured())
      throw new GmailError(500, "not_configured", "Gmail sync isn't configured on this server (AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET)");
    const gmail = client ?? gmailClient(unseal(account.refreshTokenSealed, tokenKey()));
    const exclusions = (await db.select({ value: mailExclusions.value }).from(mailExclusions)).map((r) => r.value);
    const ctx = { mailbox: account.email, internalDomains: [ALLOWED_EMAIL_DOMAIN], exclusions };

    // Which messages: everything new since the last history id; on first sync (or when Gmail no
    // longer has that history) a date search instead.
    const ids: string[] = [];
    const byDate = async (since: Date) => {
      const q = `after:${Math.floor(since.getTime() / 1000)} -in:chats -in:drafts`;
      let page: string | undefined;
      do {
        const r = await gmail.list(q, page);
        ids.push(...r.ids);
        page = r.nextPageToken;
      } while (page && ids.length < PER_RUN);
    };
    const profile = await gmail.profile();
    if (profile.emailAddress.toLowerCase() !== account.email.toLowerCase())
      throw new GmailError(403, "wrong_mailbox", `Connected to ${profile.emailAddress}, not ${account.email}`);
    let nextHistoryId = profile.historyId;
    if (!account.historyId) await byDate(new Date(now.getTime() - BACKFILL_DAYS * 86_400_000));
    else {
      let page: string | undefined;
      let expired = false;
      do {
        const r = await gmail.history(account.historyId, page);
        if (!r) {
          expired = true;
          break;
        }
        ids.push(...r.ids);
        nextHistoryId = r.historyId;
        page = r.nextPageToken;
      } while (page && ids.length < PER_RUN);
      if (expired) await byDate(account.lastSyncedAt ?? new Date(now.getTime() - BACKFILL_DAYS * 86_400_000));
    }

    // Oldest first, so the first email to someone creates them and later ones attach to them.
    const batch = [...new Set(ids)].slice(0, PER_RUN).reverse();
    for (const id of batch) {
      const msg = await gmail.get(id);
      if (!msg) continue;
      result.fetched++;
      const plan = planMessage(msg.headers, ctx);
      if (!plan.log) {
        result.skipped[plan.reason] = (result.skipped[plan.reason] ?? 0) + 1;
        continue;
      }
      const r = await logMessage(account, msg, plan);
      if (r.outcome === "logged") {
        result.logged++;
        result.contactsCreated += r.contacts;
        result.companiesCreated += r.companies;
      } else result.skipped[r.outcome] = (result.skipped[r.outcome] ?? 0) + 1;
    }

    // A partial batch (more than PER_RUN waiting) keeps the old history id so the rest come next run.
    const complete = ids.length <= PER_RUN;
    await db
      .update(mailAccounts)
      .set({
        historyId: complete ? nextHistoryId : account.historyId,
        lastSyncedAt: complete ? now : account.lastSyncedAt,
        status: "active",
        lastError: null,
        messagesLogged: sql`${mailAccounts.messagesLogged} + ${result.logged}`,
      })
      .where(eq(mailAccounts.id, account.id));
  } catch (e) {
    const revoked = e instanceof GmailError && e.revoked;
    result.error = e instanceof Error ? e.message : String(e);
    await db
      .update(mailAccounts)
      .set({ status: revoked ? "revoked" : "error", lastError: result.error })
      .where(eq(mailAccounts.id, account.id));
  }
  return result;
}

/** Sync every connected mailbox that isn't paused or revoked. */
export async function syncAllMailboxes() {
  const accounts = await db
    .select()
    .from(mailAccounts)
    .where(sql`${mailAccounts.status} in ('active', 'error')`);
  const results: SyncResult[] = [];
  for (const a of accounts) results.push(await syncAccount(a));
  return results;
}
