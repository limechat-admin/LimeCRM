/** The webhook event catalogue. No Node imports, so client forms can use it. */
export const WEBHOOK_EVENTS = [
  { key: "deal.created", label: "Deal created" },
  { key: "deal.updated", label: "Deal fields changed" },
  { key: "deal.stage_changed", label: "Deal moved stage (incl. won / lost)" },
  { key: "deal.pricing_changed", label: "Deal pricing changed" },
  { key: "organization.created", label: "Company created" },
  { key: "organization.updated", label: "Company fields changed" },
  { key: "organization.lifecycle_changed", label: "Company lifecycle changed" },
  { key: "organization.churned", label: "Company churned" },
  { key: "onboarding.created", label: "Onboarding opened" },
  { key: "onboarding.updated", label: "Onboarding fields changed" },
  { key: "onboarding.stage_changed", label: "Onboarding moved stage" },
  { key: "lead.created", label: "Lead created" },
  { key: "lead.updated", label: "Lead fields changed" },
  { key: "lead.status_changed", label: "Lead status changed" },
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]["key"] | "ping";

/** An endpoint subscribed to "*" gets every event. */
export const ALL_EVENTS = "*";
