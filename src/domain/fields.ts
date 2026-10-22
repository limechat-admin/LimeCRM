/**
 * Field standards: the managed picklists (one list of values per field, shared by every record
 * type that uses it), how messy values map onto them, and clean-up rules applied on every save.
 * Pure, so the rules are unit-tested. Values live in the `field_options` table; the seeds below
 * are the starting lists, which admins then edit under Settings → Fields.
 */

export type PicklistKey = "source" | "partner" | "industry" | "products" | "plan" | "lost_reason" | "traffic_band";

type Column = { table: "contacts" | "deals" | "organizations"; column: string; label: string };

export type PicklistDef = {
  key: PicklistKey;
  label: string;
  help: string;
  /** Multi-select (stored as text[]) rather than one value. */
  multi: boolean;
  columns: Column[];
  seeds: string[];
  /** Seeded as retired: still valid on old records, not offered for new ones. */
  retiredSeeds?: string[];
  /** Other spellings seen in Salesmate and sheets → the standard value. */
  aliases?: Record<string, string>;
};

export const PICKLISTS: PicklistDef[] = [
  {
    key: "source",
    label: "Source",
    help: "Where the lead or deal came from",
    multi: false,
    columns: [
      { table: "contacts", column: "source", label: "Lead source" },
      { table: "deals", column: "source", label: "Deal source" },
    ],
    seeds: ["Inbound", "Outbound", "Paid Ads", "Events", "Referral", "Partnerships", "Self Generation", "AI SDR", "Existing customer"],
    aliases: {
      ppc: "Paid Ads",
      "google ads": "Paid Ads",
      "meta ads": "Paid Ads",
      ads: "Paid Ads",
      "self generated": "Self Generation",
      "self gen": "Self Generation",
      selfgen: "Self Generation",
      partner: "Partnerships",
      partnership: "Partnerships",
      event: "Events",
      website: "Inbound",
      "website form": "Inbound",
      "demo form": "Inbound",
      "cold outreach": "Outbound",
      "cold email": "Outbound",
      upsell: "Existing customer",
      "cross sell": "Existing customer",
    },
  },
  {
    key: "partner",
    label: "Partner",
    help: "The partner who sourced or co-sold the deal",
    multi: false,
    columns: [
      { table: "contacts", column: "partner_name", label: "Lead partner" },
      { table: "deals", column: "partner_name", label: "Deal partner" },
    ],
    seeds: ["WebEngage", "Netcore", "CleverTap", "MoEngage", "Shopflo", "Shopify", "Other partner"],
    aliases: { "web engage": "WebEngage", "netcore cloud": "Netcore", "clever tap": "CleverTap", "mo engage": "MoEngage" },
  },
  {
    key: "industry",
    label: "Industry",
    help: "The company's industry, for segmenting reports and campaigns",
    multi: false,
    columns: [{ table: "organizations", column: "industry", label: "Company industry" }],
    seeds: ["D2C / E-commerce", "BFSI", "Hospitality", "Travel", "Healthcare", "Education", "Real Estate", "Automotive", "Martech / SaaS", "Other"],
    aliases: {
      d2c: "D2C / E-commerce",
      ecommerce: "D2C / E-commerce",
      "e commerce": "D2C / E-commerce",
      retail: "D2C / E-commerce",
      fintech: "BFSI",
      nbfc: "BFSI",
      banking: "BFSI",
      insurance: "BFSI",
      "financial services": "BFSI",
      hotels: "Hospitality",
      hotel: "Hospitality",
      edtech: "Education",
      healthtech: "Healthcare",
      saas: "Martech / SaaS",
      martech: "Martech / SaaS",
    },
  },
  {
    key: "products",
    label: "Products",
    help: "LimeChat products in a deal, or a lead's interest",
    multi: true,
    columns: [
      { table: "deals", column: "products", label: "Deal products" },
      { table: "contacts", column: "product_interest", label: "Lead product interest" },
    ],
    seeds: ["Chat BOT", "Voice BOT", "Helpdesk", "Marketing Platform"],
    aliases: {
      chat: "Chat BOT",
      chatbot: "Chat BOT",
      voice: "Voice BOT",
      voicebot: "Voice BOT",
      "voice ai": "Voice BOT",
      marketing: "Marketing Platform",
      broadcasts: "Marketing Platform",
    },
  },
  {
    key: "plan",
    label: "Plan",
    help: "The commercial plan sold",
    multi: false,
    columns: [{ table: "deals", column: "plan", label: "Deal plan" }],
    seeds: ["Enterprise/ Custom", "LimeBot", "LimeBusiness", "LimeMarketer"],
    aliases: { enterprise: "Enterprise/ Custom", custom: "Enterprise/ Custom" },
  },
  {
    key: "lost_reason",
    label: "Lost reason",
    help: "Why a deal was lost",
    multi: false,
    columns: [{ table: "deals", column: "lost_reason", label: "Deal lost reason" }],
    seeds: [
      "No Differentiation",
      "Lost To Competitor - Pricing Gap",
      "Lost To Competitor - Product Gap",
      "Budget",
      "Timeline issues",
      "AE/SDR Failure",
      "Signed but never paid",
    ],
    retiredSeeds: ["Unknown (migrated)"],
    aliases: {
      pricing: "Lost To Competitor - Pricing Gap",
      "signed, never paid (sales churn)": "Signed but never paid",
      "never paid": "Signed but never paid",
      timeline: "Timeline issues",
    },
  },
  {
    key: "traffic_band",
    label: "Website traffic",
    help: "Monthly website visits, which decides SDR coverage (Sales plan)",
    multi: false,
    columns: [{ table: "organizations", column: "website_traffic_range", label: "Company website traffic" }],
    seeds: ["Under 50K", "50K–500K", "500K–1M", "1M+"],
    aliases: {
      "<50k": "Under 50K",
      "0-50k": "Under 50K",
      "50k-500k": "50K–500K",
      "50k - 500k": "50K–500K",
      "500k-1m": "500K–1M",
      "1m+": "1M+",
      ">1m": "1M+",
      "1 m+": "1M+",
    },
  },
];

export const PICKLIST = Object.fromEntries(PICKLISTS.map((p) => [p.key, p])) as Record<PicklistKey, PicklistDef>;
export const isPicklistKey = (k: unknown): k is PicklistKey => typeof k === "string" && k in PICKLIST;

/** Case, spacing and punctuation don't count: "Paid-Ads", "paid ads" and "PAID ADS" are one value. */
export const looseKey = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[–—]/g, "-")
    .replace(/[^a-z0-9+<>]+/g, "");

/**
 * The standard value for `raw`, or null when it can't be matched. `values` are the field's current
 * values (active and retired); aliases are tried after exact-but-loose matches.
 */
export function matchOption(raw: string | null | undefined, values: string[], aliases: Record<string, string> = {}): string | null {
  if (!raw?.trim()) return null;
  const k = looseKey(raw);
  const hit = values.find((v) => looseKey(v) === k);
  if (hit) return hit;
  const alias = Object.entries(aliases).find(([a]) => looseKey(a) === k)?.[1];
  return alias && values.includes(alias) ? alias : null;
}

// ---------- clean-up on save ----------

/** "https://www.Acme.in/about?x=1" → "acme.in". Null when there's no plausible domain. */
export function normalizeWebsite(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const host = raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#\s]/)[0]
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
}

/** A link for a stored domain. */
export const websiteHref = (domain: string) => (/^https?:\/\//i.test(domain) ? domain : `https://${domain}`);

export function normalizeEmail(raw: string | null | undefined): string | null {
  const e = raw?.trim().toLowerCase();
  return e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

/**
 * Phones to E.164 where it's unambiguous: Indian mobiles ("98765 43210", "+91-98765-43210",
 * "09876543210") become +919876543210, and numbers given with a + keep their country code.
 * Anything else is kept as typed, trimmed, so nothing is lost.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const t = raw.trim();
  const digits = t.replace(/\D/g, "");
  if (t.startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  if (/^[6-9]\d{9}$/.test(digits)) return `+91${digits}`;
  if (/^0[6-9]\d{9}$/.test(digits)) return `+91${digits.slice(1)}`;
  if (/^91[6-9]\d{9}$/.test(digits)) return `+${digits}`;
  return t.replace(/\s+/g, " ");
}

/** Trim and collapse whitespace; names keep their casing (IHCL, boAt and WebEngage are all right). */
export const tidyName = (raw: string) => raw.trim().replace(/\s+/g, " ");

/** Free-mail and other domains that aren't a company (no company is created or matched from them). */
export const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.in",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "icloud.com",
  "me.com",
  "rediffmail.com",
  "protonmail.com",
  "proton.me",
  "aol.com",
  "zoho.com",
]);

/** "Paid Ads" → "Paid Ads"; ["chat", "Voice"] → ["Chat BOT", "Voice BOT"]; unknowns reported separately. */
export function standardize(def: Pick<PicklistDef, "aliases">, values: string[], raw: string[]): { values: string[]; unknown: string[] } {
  const out: string[] = [];
  const unknown: string[] = [];
  for (const r of raw) {
    const m = matchOption(r, values, def.aliases);
    if (m) {
      if (!out.includes(m)) out.push(m);
    } else if (r.trim()) unknown.push(r.trim());
  }
  return { values: out, unknown };
}
