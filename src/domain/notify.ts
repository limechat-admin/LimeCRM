/** Slack notification content and channel naming. Pure, so the wording is unit-tested. */

export type NotificationKind = "deal_won" | "deal_lost" | "handed_to_cs" | "churned" | "client_channel" | "daily_digest" | "renewal_due";

/** `color` is the bar down the message's left edge, from the LimeChat palette (src/theme/theme.ts). */
export type SlackMessage = { text: string; blocks: unknown[]; color: string };

/** LimeChat Design System V3 colours, as hex because Slack can't read CSS variables. */
export const BRAND = {
  lime: "#6bac1b", // primary: wins, digests
  limeDark: "#508014", // renewals
  green: "#16a34a", // handed to CS
  red: "#da1b21", // churn
  gray: "#8c8c8c", // losses
} as const;

const inrFmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const inr = (n: number) => inrFmt.format(n);

/** Slack mrkdwn needs &, < and > escaped in user-supplied text. */
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const link = (url: string, label: string) => `<${url}|${esc(label)}>`;

const section = (text: string) => ({ type: "section", text: { type: "mrkdwn", text } });
const context = (text: string) => ({ type: "context", elements: [{ type: "mrkdwn", text }] });

/**
 * Client channel name per the handoff SOP: client-o-<company>. Slack allows lowercase letters,
 * digits, - and _, up to 80 characters.
 */
export function clientChannelName(company: string): string {
  const slug = company
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `client-o-${slug || "client"}`.slice(0, 80).replace(/-+$/, "");
}

export type DealPayload = {
  url: string;
  title: string;
  company: string;
  mrr: number;
  oneTimeFee: number;
  owner: string | null;
  sdr?: string | null;
  products?: string[];
  lostReason?: string | null;
  stage?: string;
};

export function dealWonMessage(p: DealPayload): SlackMessage {
  const who = [p.owner && `AE ${p.owner}`, p.sdr && `SDR ${p.sdr}`].filter(Boolean).join(" · ");
  const extras = [p.products?.length ? p.products.join(", ") : null, p.oneTimeFee > 0 ? `${inr(p.oneTimeFee)} one-time` : null].filter(Boolean).join(" · ");
  return {
    color: BRAND.lime,
    text: `Won: ${p.title}, ${inr(p.mrr)}/mo`,
    blocks: [
      section(`:tada: *Won:* ${link(p.url, p.title)}\n*${inr(p.mrr)}/mo* · ${esc(p.company)}`),
      context([who, extras].filter(Boolean).map(esc).join(" · ") || "LimeCRM"),
    ],
  };
}

export function dealLostMessage(p: DealPayload): SlackMessage {
  return {
    color: BRAND.gray,
    text: `Lost: ${p.title}`,
    blocks: [
      section(`*Lost:* ${link(p.url, p.title)} (${esc(p.stage ?? "Closed Lost")})\n${inr(p.mrr)}/mo · ${esc(p.company)}`),
      context(esc([p.lostReason ? `Reason: ${p.lostReason}` : null, p.owner ? `AE ${p.owner}` : null].filter(Boolean).join(" · ") || "No reason given")),
    ],
  };
}

export type OrgPayload = {
  url: string;
  company: string;
  mrr: number;
  csm?: string | null;
  om?: string | null;
  nps?: number | null;
  category?: string | null;
  reason?: string | null;
  lastBillingDate?: string | null;
};

export function handedToCsMessage(p: OrgPayload): SlackMessage {
  return {
    color: BRAND.green,
    text: `Handed to CS: ${p.company}`,
    blocks: [
      section(`:handshake: *Handed to CS:* ${link(p.url, p.company)}, ${inr(p.mrr)}/mo`),
      context(esc([p.om && `Onboarded by ${p.om}`, p.csm && `CSM ${p.csm}`, p.nps != null && `NPS ${p.nps}`].filter(Boolean).join(" · ") || "LimeCRM")),
    ],
  };
}

export function churnedMessage(p: OrgPayload): SlackMessage {
  return {
    color: BRAND.red,
    text: `Churned: ${p.company}, ${inr(p.mrr)}/mo`,
    blocks: [
      section(`:rotating_light: *Churned:* ${link(p.url, p.company)}\n*${inr(p.mrr)}/mo lost*${p.category ? ` · ${esc(p.category)}` : ""}`),
      context(esc([p.reason, p.lastBillingDate && `Last billing ${p.lastBillingDate}`, p.csm && `CSM ${p.csm}`].filter(Boolean).join(" · ") || "No reason given")),
    ],
  };
}

export function clientChannelIntro(p: { company: string; url: string; ae: string | null; om: string | null }): SlackMessage {
  return {
    color: BRAND.lime,
    text: `Client channel for ${p.company}`,
    blocks: [
      section(`This is the client channel for ${link(p.url, p.company)}.`),
      context(esc([p.ae && `AE ${p.ae}`, p.om && `Onboarding ${p.om}`].filter(Boolean).join(" · ") || "Created by LimeCRM at handover")),
    ],
  };
}

export type RenewalPayload = { url: string; company: string; deal: string; renewalDate: string; daysLeft: number; mrr: number; owner: string | null };

export function renewalDueMessage(p: RenewalPayload): SlackMessage {
  const when = p.daysLeft <= 0 ? "*today*" : `in *${p.daysLeft} day${p.daysLeft === 1 ? "" : "s"}*`;
  return {
    color: BRAND.limeDark,
    text: `Renewal due: ${p.company} on ${p.renewalDate}`,
    blocks: [section(`:spiral_calendar_pad: *Renewal due* ${when}: ${link(p.url, p.company)} · ${esc(p.deal)} · ${inr(p.mrr)}/mo`), context(esc(`Renews ${p.renewalDate}${p.owner ? ` · ${p.owner}` : ""}`))],
  };
}

export type DigestItem = { label: string; url: string; detail: string };
export type DigestPayload = { name: string; overdue: DigestItem[]; today: DigestItem[]; stale: DigestItem[]; workUrl: string };

/** Morning DM: overdue and today's tasks, and stale deals. Nothing is sent when all three are empty. */
export function dailyDigestMessage(p: DigestPayload): SlackMessage | null {
  if (!p.overdue.length && !p.today.length && !p.stale.length) return null;
  const list = (title: string, items: DigestItem[]) => {
    const shown = items.slice(0, 8).map((i) => `• ${link(i.url, i.label)}: ${esc(i.detail)}`);
    if (items.length > 8) shown.push(`• …and ${items.length - 8} more`);
    return `*${title} (${items.length})*\n${shown.join("\n")}`;
  };
  const parts = [p.overdue.length && list("Overdue", p.overdue), p.today.length && list("Due today", p.today), p.stale.length && list("Deals gone quiet", p.stale)].filter(
    (x): x is string => !!x,
  );
  return {
    color: BRAND.lime,
    text: `Good morning ${p.name}: ${p.overdue.length} overdue, ${p.today.length} due today, ${p.stale.length} quiet deals`,
    blocks: [section(`Good morning ${esc(p.name.split(" ")[0])}. Here's your LimeCRM day.`), ...parts.map(section), context(link(p.workUrl, "Open My work"))],
  };
}

/** Exponential backoff for failed sends: 1, 4, 16, 64 minutes, then give up. */
export const MAX_ATTEMPTS = 5;
export function retryDelayMinutes(attempts: number): number {
  return 4 ** Math.max(0, attempts - 1);
}
