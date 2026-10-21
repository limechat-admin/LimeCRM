const inrFmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const inrPreciseFmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });

export const inr = (n: number | null | undefined) => inrFmt.format(n ?? 0);
export const inrPrecise = (n: number | null | undefined) => inrPreciseFmt.format(n ?? 0);

/** Compact Indian notation for board headers: ₹12.3L, ₹1.04Cr. */
export function inrCompact(n: number) {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(1)}K`;
  return `₹${Math.round(n)}`;
}

export function shortDate(d: string | Date | null | undefined) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(`${d}T00:00:00`) : d;
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function dateTime(d: Date) {
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export const LIFECYCLE_LABEL = {
  prospect: "Prospect",
  onboarding: "Onboarding",
  active: "Active",
  on_hold: "On hold",
  churned: "Churned",
} as const;

export const SEGMENT_LABEL = {
  enterprise: "Enterprise",
  mid_market: "Mid-Market",
  growth_dedicated: "Growth · Dedicated",
  growth_self_serve: "Growth · Self-serve",
} as const;

export const DEAL_TYPE_LABEL = {
  new_business: "New business",
  upsell: "Upsell",
  cross_sell: "Cross-sell",
  renewal: "Renewal",
  addendum: "Addendum",
} as const;

export const LINE_ITEM_LABEL = {
  platform_fee: "Platform fee",
  agent_seat: "Agent seats",
  bot_session: "Bot sessions",
  wa_marketing: "WhatsApp marketing",
  wa_utility: "WhatsApp utility",
  voice_minute: "Voice minutes",
  inbound_calling: "Inbound calling",
  outbound_calling: "Outbound calling",
  sms: "SMS",
  email: "Email",
  image_ai: "Image AI",
  implementation_fee: "Implementation fee",
  other: "Other",
} as const;

export const CYCLE_LABEL = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  semi_annual: "Semi-annual",
  annual: "Annual",
  one_time: "One-time",
} as const;

export const CHURN_LABEL = {
  payment: "Payment",
  business: "Business",
  onboarding_experience: "Onboarding experience",
  low_value: "Low value",
  support_issues: "Support issues",
  competition_product: "Competition · product",
  competition_pricing: "Competition · pricing",
  corporate_changes: "Corporate changes",
  did_not_start: "Did not start with LC",
  self_serve: "Self serve",
  product_gaps: "Product issues / gaps",
  partner_churn: "Partner churn",
} as const;

export const ACTIVITY_LABEL = {
  call: "Call",
  task: "Task",
  meeting: "Meeting",
  demo: "Demo",
  email: "Email",
  linkedin: "LinkedIn",
  whatsapp: "WhatsApp",
  note: "Note",
  attempted_contact: "Attempted contact",
} as const;

/** Human labels for field names in "updated" history entries. */
export const FIELD_LABEL: Record<string, string> = {
  title: "Title",
  type: "Type",
  ownerId: "Account Executive",
  sdrId: "SDR",
  primaryContactId: "Primary contact",
  source: "Source",
  partnerName: "Partner",
  plan: "Plan",
  products: "Products",
  priority: "Priority",
  expectedCloseDate: "Expected close",
  billingCycle: "Billing cycle",
  currency: "Currency",
  contractStart: "Contract start",
  contractRenewal: "Contract renewal",
  contractLink: "Contract link",
  requiresOnboarding: "Needs onboarding",
  lostReason: "Lost reason",
  lostDetail: "Lost detail",
  name: "Name",
  website: "Website",
  segment: "Segment",
  industry: "Industry",
  hqCity: "HQ city",
  aeId: "AE",
  omId: "Onboarding manager",
  csmId: "CSM",
  lcAccountIds: "LC Account IDs",
  chargebeeCustomerId: "Chargebee ID",
  clientChannel: "Slack channel",
  health: "Health",
  healthNote: "Health note",
  kickoffDate: "Kick-off date",
  goLiveDate: "Go-live date",
  nps: "NPS",
  voiceAdoption: "Voice adoption",
  notes: "Notes",
};

/** { value, label } pairs for Mantine Select from a label map. */
export const options = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }));

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
