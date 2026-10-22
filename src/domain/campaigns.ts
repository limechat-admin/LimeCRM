/**
 * Email campaigns: content blocks, personalisation, the branded email they render to, subscription
 * types and list filters. Pure, so rendering and escaping are unit-tested. Sending is in
 * src/server/campaigns.ts.
 */
import { z } from "zod";

// ---------- content ----------

export const blockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heading"), text: z.string().max(200) }),
  z.object({ type: z.literal("text"), text: z.string().max(5000) }),
  z.object({ type: z.literal("button"), label: z.string().max(60), url: z.string().max(1000) }),
  z.object({ type: z.literal("image"), src: z.string().max(1000), alt: z.string().max(200), href: z.string().max(1000).optional() }),
  z.object({ type: z.literal("divider") }),
]);
export type Block = z.infer<typeof blockSchema>;
export const blocksSchema = z.array(blockSchema).max(40);

export const BLOCK_LABEL: Record<Block["type"], string> = { heading: "Heading", text: "Text", button: "Button", image: "Image", divider: "Divider" };

export const STARTER_BLOCKS: Block[] = [
  { type: "heading", text: "Hi {{first_name|there}}," },
  { type: "text", text: "Write your message here. Use **bold** for emphasis and [a link](https://limechat.ai) where it helps." },
  { type: "button", label: "Book a demo", url: "https://limechat.ai" },
  { type: "text", text: "— {{sender_name|Team LimeChat}}" },
];

// ---------- personalisation ----------

export type Vars = { first_name: string; name: string; company: string; email: string; ae_name: string; sender_name: string };
export const TOKENS: { key: keyof Vars; label: string }[] = [
  { key: "first_name", label: "First name" },
  { key: "name", label: "Full name" },
  { key: "company", label: "Company" },
  { key: "ae_name", label: "Account executive" },
  { key: "sender_name", label: "Sender name" },
  { key: "email", label: "Email" },
];

/** `{{first_name}}` or `{{first_name|there}}` (fallback when empty). Unknown tokens are left as typed. */
export function fillTokens(s: string, vars: Partial<Vars>): string {
  return s.replace(/\{\{\s*([a-z_]+)\s*(?:\|([^}]*))?\}\}/g, (all, key: string, fallback?: string) => {
    if (!(key in vars) && !TOKENS.some((t) => t.key === key)) return all;
    const v = vars[key as keyof Vars];
    return v?.trim() ? v : (fallback ?? "").trim();
  });
}

export const firstName = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] ?? "";

// ---------- rendering ----------

const BRAND = {
  lime: "#6bac1b",
  ink: "#3c492c",
  muted: "#808975",
  line: "#e3efd2",
  page: "#f5f5f5",
  card: "#ffffff",
  font: "Lato, 'Helvetica Neue', Arial, sans-serif",
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Only http(s) and mailto links survive; anything else (javascript:, data:) becomes "#". */
export function safeUrl(url: string): string {
  const u = url.trim();
  return /^(https?:\/\/|mailto:)/i.test(u) ? u : "#";
}

/** Escaped text with **bold**, [label](url) links and bare URLs; blank lines split paragraphs. */
function inline(text: string): string {
  let out = esc(text);
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_, label: string, url: string) => `<a href="${esc(safeUrl(url.replace(/&amp;/g, "&")))}" style="color:${BRAND.lime};">${label}</a>`,
  );
  out = out.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, pre: string, url: string) => `${pre}<a href="${url}" style="color:${BRAND.lime};">${url}</a>`);
  return out.replace(/\n/g, "<br>");
}

const plainInline = (text: string) => text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1 ($2)");

export type Footer = { companyLine: string; address: string; unsubscribeUrl: string; preferencesUrl: string; reason: string };
export type Rendered = { subject: string; html: string; text: string };

export function renderEmail(c: { subject: string; preheader: string | null; blocks: Block[]; logoUrl: string }, vars: Partial<Vars>, footer: Footer): Rendered {
  const fill = (s: string) => fillTokens(s, vars);
  const td = (inner: string, pad = "8px 32px") => `<tr><td style="padding:${pad};">${inner}</td></tr>`;
  const rows: string[] = [];
  const text: string[] = [];
  for (const b of c.blocks) {
    if (b.type === "heading") {
      rows.push(td(`<h1 style="margin:0;font-size:22px;line-height:30px;font-weight:700;color:${BRAND.ink};">${esc(fill(b.text))}</h1>`, "16px 32px 8px"));
      text.push(fill(b.text), "");
    } else if (b.type === "text") {
      const paras = fill(b.text)
        .split(/\n\s*\n/)
        .filter((p) => p.trim());
      rows.push(td(paras.map((p) => `<p style="margin:0 0 12px;font-size:16px;line-height:24px;color:${BRAND.ink};">${inline(p)}</p>`).join("")));
      text.push(...paras.map(plainInline), "");
    } else if (b.type === "button") {
      const url = esc(safeUrl(fill(b.url)));
      rows.push(
        td(
          `<a href="${url}" style="display:inline-block;background:${BRAND.lime};color:#ffffff;font-weight:700;font-size:16px;line-height:20px;text-decoration:none;padding:12px 24px;border-radius:4px;">${esc(fill(b.label))}</a>`,
          "12px 32px",
        ),
      );
      text.push(`${fill(b.label)}: ${safeUrl(fill(b.url))}`, "");
    } else if (b.type === "image") {
      const img = `<img src="${esc(safeUrl(b.src))}" alt="${esc(fill(b.alt))}" width="536" style="display:block;width:100%;max-width:536px;height:auto;border:0;border-radius:4px;">`;
      rows.push(td(b.href ? `<a href="${esc(safeUrl(fill(b.href)))}">${img}</a>` : img));
      if (b.alt) text.push(`[${fill(b.alt)}]`, "");
    } else {
      rows.push(td(`<hr style="border:0;border-top:1px solid ${BRAND.line};margin:8px 0;">`));
      text.push("———", "");
    }
  }
  const preheader = c.preheader ? fill(c.preheader) : "";
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(fill(c.subject))}</title></head>
<body style="margin:0;padding:0;background:${BRAND.page};font-family:${BRAND.font};">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.page};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:${BRAND.card};border-radius:8px;border-top:4px solid ${BRAND.lime};">
${td(`<img src="${esc(c.logoUrl)}" alt="LimeChat" height="28" style="display:block;height:28px;width:auto;border:0;">`, "24px 32px 8px")}
${rows.join("\n")}
${td("&nbsp;", "8px 32px")}
</table>
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;"><tr><td style="padding:16px 32px;font-size:12px;line-height:18px;color:${BRAND.muted};text-align:center;">
${esc(footer.reason)}<br>
<a href="${esc(footer.preferencesUrl)}" style="color:${BRAND.muted};">Email preferences</a> · <a href="${esc(footer.unsubscribeUrl)}" style="color:${BRAND.muted};">Unsubscribe</a><br>
${esc(footer.companyLine)}, ${esc(footer.address)}
</td></tr></table>
</td></tr></table>
</body></html>`;
  const plain = [
    ...text,
    "—",
    footer.reason,
    `Email preferences: ${footer.preferencesUrl}`,
    `Unsubscribe: ${footer.unsubscribeUrl}`,
    `${footer.companyLine}, ${footer.address}`,
  ]
    .join("\n")
    .trim();
  return { subject: fill(c.subject), html, text: plain };
}

// ---------- subscriptions ----------

export const SUBSCRIPTION_TYPES = [
  { key: "product_updates", label: "Product updates", help: "New features and what's changed in LimeChat" },
  { key: "events", label: "Webinars and events", help: "Invitations to webinars, meetups and events" },
  { key: "offers", label: "Offers and case studies", help: "Customer stories, guides and offers" },
] as const;
export type SubscriptionType = (typeof SUBSCRIPTION_TYPES)[number]["key"];
export const isSubscriptionType = (v: unknown): v is SubscriptionType => SUBSCRIPTION_TYPES.some((t) => t.key === v);

export type Preference = { unsubscribedAll: boolean; optedOut: string[]; suppressed: string | null } | undefined;

/** Why someone won't get a campaign of this type, or null if they will. */
export function blockedReason(pref: Preference, type: SubscriptionType): string | null {
  if (!pref) return null;
  if (pref.suppressed)
    return pref.suppressed === "spam_complaint" ? "Marked an email as spam" : pref.suppressed === "hard_bounce" ? "Address bounced" : "Suppressed";
  if (pref.unsubscribedAll) return "Unsubscribed from all";
  if (pref.optedOut.includes(type)) return "Unsubscribed from this type";
  return null;
}

// ---------- lists ----------

/** An active list: who's in it is worked out from these filters every time it's used. */
export const listFiltersSchema = z.object({
  audience: z.enum(["leads", "contacts"]).default("leads"),
  leadStatuses: z.array(z.string()).default([]),
  sdrIds: z.array(z.string().uuid()).default([]),
  ownerIds: z.array(z.string().uuid()).default([]),
  sources: z.array(z.string()).default([]),
  products: z.array(z.string()).default([]),
  lifecycles: z.array(z.string()).default([]),
  segments: z.array(z.string()).default([]),
  industries: z.array(z.string()).default([]),
  trafficBands: z.array(z.string()).default([]),
  reconnectDueBy: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
});
export type ListFilters = z.infer<typeof listFiltersSchema>;

/** One line describing a list's filters, for list pages and the campaign summary. */
export function describeFilters(f: ListFilters, names: (kind: "user", id: string) => string): string {
  const parts: string[] = [f.audience === "leads" ? "Leads" : "Everyone with an email"];
  const add = (label: string, values: string[]) => values.length && parts.push(`${label}: ${values.join(", ")}`);
  add("status", f.leadStatuses);
  add(
    "SDR",
    f.sdrIds.map((id) => names("user", id)),
  );
  add(
    "AE",
    f.ownerIds.map((id) => names("user", id)),
  );
  add("source", f.sources);
  add("products", f.products);
  add("lifecycle", f.lifecycles);
  add("segment", f.segments);
  add("industry", f.industries);
  add("traffic", f.trafficBands);
  if (f.reconnectDueBy) parts.push(`reconnect due by ${f.reconnectDueBy}`);
  return parts.join(" · ");
}

// ---------- results ----------

export type CampaignCounts = {
  recipients: number;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  complained: number;
  unsubscribed: number;
  skipped: number;
  failed: number;
};
const rate = (n: number, of: number) => (of ? n / of : null);
export function campaignRates(c: CampaignCounts) {
  return {
    delivery: rate(c.delivered, c.sent),
    open: rate(c.opened, c.delivered),
    click: rate(c.clicked, c.delivered),
    clickToOpen: rate(c.clicked, c.opened),
    bounce: rate(c.bounced, c.sent),
    unsubscribe: rate(c.unsubscribed, c.delivered),
  };
}
