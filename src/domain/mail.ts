/**
 * Email capture rules (Gmail sync): which messages are logged, who the outside people are, and what
 * to call new contacts and companies. Pure, so the rules are unit-tested.
 *
 * The rule that keeps the CRM clean: new contacts and companies are created only from mail a rep
 * sends. Incoming mail is logged only when the sender is already in LimeCRM, so recruiters, vendors
 * and cold pitches don't turn into prospects.
 */
import { PERSONAL_EMAIL_DOMAINS } from "./fields";

export type Address = { email: string; name: string | null };

/** Parse a header like `"Nair, Priya" <Priya@Tealeaf.in>, ops@acme.com` into lower-cased addresses. */
export function parseAddressList(header: string | null | undefined): Address[] {
  if (!header?.trim()) return [];
  const out: Address[] = [];
  // Split on commas that aren't inside quotes or angle brackets.
  const parts: string[] = [];
  let cur = "";
  let quoted = false;
  let angle = 0;
  for (const ch of header) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "<" && !quoted) angle++;
    else if (ch === ">" && !quoted) angle = Math.max(0, angle - 1);
    if (ch === "," && !quoted && angle === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;
    const m = p.match(/^(.*)<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/);
    const email = (m ? m[2] : p).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
    const name = m
      ? m[1]
          .trim()
          .replace(/^"(.*)"$/, "$1")
          .trim() || null
      : null;
    if (!out.some((a) => a.email === email)) out.push({ email, name: name && name.toLowerCase() !== email ? name : null });
  }
  return out;
}

export const emailDomain = (email: string) => email.split("@")[1]?.toLowerCase() ?? "";

export type MailHeaders = {
  from: string | null;
  to: string | null;
  cc: string | null;
  subject: string | null;
  date: string | null;
  messageId: string | null;
  listUnsubscribe?: string | null;
  listId?: string | null;
  precedence?: string | null;
  autoSubmitted?: string | null;
};

export type MailContext = {
  /** The connected mailbox's own address. */
  mailbox: string;
  /** Our own domains (limechat.ai): never outside people. */
  internalDomains: string[];
  /** Never-log list: domains ("vendor.com") and addresses ("someone@x.com"). */
  exclusions: string[];
};

const AUTOMATED_LOCAL =
  /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?|alerts?|calendar-notification|bounce[s]?|support-noreply|billing|invoices?)([+.-].*)?$/i;

export type MailPlan =
  | { log: false; reason: "automated" | "bulk" | "internal" | "excluded" | "no_date" }
  | {
      log: true;
      direction: "outbound" | "inbound";
      from: Address;
      /** Outside people on the message (sender and recipients), excluding our own and never-log ones. */
      externals: Address[];
      subject: string;
      sentAt: Date;
      messageId: string | null;
    };

/** More recipients than this is a mass mail, not a conversation. */
export const MAX_RECIPIENTS = 20;

export function planMessage(h: MailHeaders, ctx: MailContext): MailPlan {
  const internal = new Set(ctx.internalDomains.map((d) => d.toLowerCase()));
  const excluded = new Set(ctx.exclusions.map((e) => e.trim().toLowerCase()).filter(Boolean));
  const from = parseAddressList(h.from)[0];
  if (!from) return { log: false, reason: "automated" };
  if (h.listUnsubscribe || h.listId || /^(bulk|list|junk)$/i.test(h.precedence ?? "") || (h.autoSubmitted && h.autoSubmitted.toLowerCase() !== "no")) {
    return { log: false, reason: "bulk" };
  }
  if (AUTOMATED_LOCAL.test(from.email.split("@")[0])) return { log: false, reason: "automated" };
  const recipients = [...parseAddressList(h.to), ...parseAddressList(h.cc)];
  if (recipients.length > MAX_RECIPIENTS) return { log: false, reason: "bulk" };

  const isOurs = (a: Address) => a.email === ctx.mailbox.toLowerCase() || internal.has(emailDomain(a.email));
  const isExcluded = (a: Address) => excluded.has(a.email) || excluded.has(emailDomain(a.email));
  const everyone = [from, ...recipients].filter((a, i, all) => all.findIndex((b) => b.email === a.email) === i);
  const outside = everyone.filter((a) => !isOurs(a));
  if (!outside.length) return { log: false, reason: "internal" };
  const externals = outside.filter((a) => !isExcluded(a) && !AUTOMATED_LOCAL.test(a.email.split("@")[0]));
  if (!externals.length) return { log: false, reason: "excluded" };

  const sentAt = h.date ? new Date(h.date) : null;
  if (!sentAt || Number.isNaN(sentAt.getTime())) return { log: false, reason: "no_date" };
  return {
    log: true,
    direction: isOurs(from) ? "outbound" : "inbound",
    from,
    externals,
    subject: h.subject?.trim() || "(no subject)",
    sentAt,
    messageId: h.messageId?.trim() || null,
  };
}

const titleCase = (s: string) => s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());

/** "Priya Nair" from the header, else from the address: priya.nair@x → "Priya Nair". */
export function contactNameFor(a: Address): string {
  if (a.name) return a.name.replace(/\s+/g, " ").trim();
  return (
    titleCase(
      a.email
        .split("@")[0]
        .replace(/[._-]+/g, " ")
        .replace(/\d+/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    ) || a.email
  );
}

/** "tealeaf-organics.co.in" → "Tealeaf Organics": a placeholder name until someone edits it. */
export function companyNameFromDomain(domain: string): string {
  const parts = domain.toLowerCase().split(".");
  const secondLevel = new Set(["co", "com", "org", "net", "gov", "ac", "edu"]);
  const tld = parts.length > 2 && secondLevel.has(parts[parts.length - 2]) ? 3 : 2;
  const name = parts.slice(0, Math.max(1, parts.length - tld + 1)).pop() ?? domain;
  return titleCase(name.replace(/[-_]+/g, " "));
}

/** Free-mail addresses get a contact but no company. */
export const isPersonalDomain = (domain: string) => PERSONAL_EMAIL_DOMAINS.has(domain.toLowerCase());

/** The subject shown on the timeline: "Sent: …" or "Received: …". */
export const activitySubject = (p: Extract<MailPlan, { log: true }>) => `${p.direction === "outbound" ? "Sent" : "Received"}: ${p.subject}`.slice(0, 300);

/** Snippets only, never the body: enough to recall the email, short enough to keep mail private. */
export const MAX_SNIPPET = 240;
export const trimSnippet = (s: string | null | undefined) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > MAX_SNIPPET ? `${t.slice(0, MAX_SNIPPET - 1)}…` : t;
};
