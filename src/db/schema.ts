import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------- enums ----------

export const userRole = pgEnum("user_role", ["admin", "sales", "onboarding", "cs", "finance", "viewer"]);

// Replaces Salesmate's Company Type / Deal Level / Nature Of The Account / Account Classifier.
export const segment = pgEnum("segment", ["enterprise", "mid_market", "growth_dedicated", "growth_self_serve"]);

export const lifecycle = pgEnum("lifecycle", ["prospect", "onboarding", "active", "on_hold", "churned"]);

export const pipelineKey = pgEnum("pipeline_key", ["sales", "onboarding"]);

// Status is derived from the stage kind, never typed by hand.
export const stageKind = pgEnum("stage_kind", ["open", "won", "lost", "hold"]);

export const dealType = pgEnum("deal_type", ["new_business", "upsell", "cross_sell", "renewal", "addendum"]);

export const dealStatus = pgEnum("deal_status", ["open", "won", "lost"]);

export const billingCycle = pgEnum("billing_cycle", ["monthly", "quarterly", "semi_annual", "annual", "one_time"]);

export const currency = pgEnum("currency", ["INR", "USD"]);

export const priority = pgEnum("priority", ["high", "medium", "low"]);

// Seeded from the Salesmate rate-card fields (Per Agent Fee, Cost Per Bot Session, WA charges, voice, SMS, ...).
export const lineItemKind = pgEnum("line_item_kind", [
  "platform_fee",
  "agent_seat",
  "bot_session",
  "wa_marketing",
  "wa_utility",
  "voice_minute",
  "inbound_calling",
  "outbound_calling",
  "sms",
  "email",
  "image_ai",
  "implementation_fee",
  "other",
]);

export const activityType = pgEnum("activity_type", [
  "call",
  "task",
  "meeting",
  "demo",
  "email",
  "linkedin",
  "whatsapp",
  "note",
  "attempted_contact",
]);

// API key permissions. `write` includes `read` (src/domain/api-keys.ts).
export const apiKeyScope = pgEnum("api_key_scope", ["read", "write"]);

export const health = pgEnum("health", ["green", "yellow", "red"]);

export const churnCategory = pgEnum("churn_category", [
  "payment",
  "business",
  "onboarding_experience",
  "low_value",
  "support_issues",
  "competition_product",
  "competition_pricing",
  "corporate_changes",
  "did_not_start",
  "self_serve",
  "product_gaps",
  "partner_churn",
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// ---------- tables ----------

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: userRole("role").notNull().default("viewer"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamps.createdAt,
});

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    website: text("website"),
    segment: segment("segment"),
    industry: text("industry"),
    websiteTrafficRange: text("website_traffic_range"),
    hqCity: text("hq_city"),
    lifecycle: lifecycle("lifecycle").notNull().default("prospect"),
    aeId: uuid("ae_id").references(() => users.id),
    omId: uuid("om_id").references(() => users.id),
    csmId: uuid("csm_id").references(() => users.id),
    lcAccountIds: integer("lc_account_ids").array().notNull().default(sql`'{}'::integer[]`),
    chargebeeCustomerId: text("chargebee_customer_id"),
    clientChannel: text("client_channel"),
    health: health("health"),
    healthNote: text("health_note"),
    // Contracted MRR: sum of won, recurring deal MRR. Recomputed by the domain layer, never edited directly.
    contractedMrr: numeric("contracted_mrr", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
    churnedAt: date("churned_at"),
    churnCategory: churnCategory("churn_category"),
    churnReason: text("churn_reason"),
    churnLastBillingDate: date("churn_last_billing_date"),
    // Nurture (Salesmate's Reconnect pipeline): get back in touch on this day. The daily job opens a task for the AE.
    reconnectOn: date("reconnect_on"),
    reconnectReason: text("reconnect_reason"),
    salesmateCompanyId: integer("salesmate_company_id"),
    ...timestamps,
  },
  (t) => [index("organizations_lifecycle_idx").on(t.lifecycle), index("organizations_name_idx").on(t.name)],
);

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    designation: text("designation"),
    isDecisionMaker: boolean("is_decision_maker").notNull().default(false),
    linkedinUrl: text("linkedin_url"),
    // Canonical values in src/domain/leads.ts (LEAD_STATUSES / LEAD_STAGES); text so imports can't fail on unknowns.
    leadStatus: text("lead_status"),
    leadStage: text("lead_stage"),
    source: text("source"),
    partnerName: text("partner_name"),
    // What was pitched / what they're interested in (Salesmate "Product Type").
    productInterest: text("product_interest").array().notNull().default(sql`'{}'::text[]`),
    // BANT, 0–25 each; the total decides Qualified Meeting (50+) vs SQL (75+).
    bantBudget: integer("bant_budget"),
    bantAuthority: integer("bant_authority"),
    bantNeed: integer("bant_need"),
    bantTimeline: integer("bant_timeline"),
    meetingScheduledAt: date("meeting_scheduled_at"),
    meetingCompletedAt: date("meeting_completed_at"),
    qualifiedAt: date("qualified_at"),
    sqlAt: date("sql_at"),
    disqualifiedReason: text("disqualified_reason"),
    ownerId: uuid("owner_id").references(() => users.id),
    sdrId: uuid("sdr_id").references(() => users.id),
    salesmateContactId: integer("salesmate_contact_id"),
    ...timestamps,
  },
  (t) => [
    index("contacts_org_idx").on(t.orgId),
    index("contacts_email_idx").on(t.email),
    index("contacts_lead_status_idx").on(t.leadStatus),
    index("contacts_owner_idx").on(t.ownerId),
  ],
);

export const stages = pgTable(
  "stages",
  {
    id: serial("id").primaryKey(),
    pipeline: pipelineKey("pipeline").notNull(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    kind: stageKind("kind").notNull().default("open"),
    winProbability: integer("win_probability"),
    // Gate: field keys (see src/domain/gates.ts) that must be filled to enter this stage.
    // For open/won stages the requirements of earlier stages carry forward.
    requiredFields: text("required_fields").array().notNull().default(sql`'{}'::text[]`),
  },
  (t) => [uniqueIndex("stages_pipeline_key_uq").on(t.pipeline, t.key)],
);

export const deals = pgTable(
  "deals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    primaryContactId: uuid("primary_contact_id").references(() => contacts.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    type: dealType("type").notNull().default("new_business"),
    stageId: integer("stage_id")
      .notNull()
      .references(() => stages.id),
    status: dealStatus("status").notNull().default("open"),
    ownerId: uuid("owner_id").references(() => users.id),
    sdrId: uuid("sdr_id").references(() => users.id),
    source: text("source"),
    partnerName: text("partner_name"),
    plan: text("plan"),
    products: text("products").array().notNull().default(sql`'{}'::text[]`),
    priority: priority("priority"),
    expectedCloseDate: date("expected_close_date"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    // Set when a won contract stops counting toward MRR (churn, or superseded by a renewal/downgrade).
    endedAt: date("ended_at"),
    lostReason: text("lost_reason"),
    lostDetail: text("lost_detail"),
    billingCycle: billingCycle("billing_cycle"),
    currency: currency("currency").notNull().default("INR"),
    contractStart: date("contract_start"),
    contractRenewal: date("contract_renewal"),
    contractLink: text("contract_link"),
    requiresOnboarding: boolean("requires_onboarding").notNull().default(true),
    // Derived from line items (src/domain/mrr.ts). Never edited directly.
    mrr: numeric("mrr", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
    oneTimeFee: numeric("one_time_fee", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
    salesmateDealIds: integer("salesmate_deal_ids").array().notNull().default(sql`'{}'::integer[]`),
    ...timestamps,
  },
  (t) => [
    index("deals_org_idx").on(t.orgId),
    index("deals_stage_idx").on(t.stageId),
    index("deals_owner_idx").on(t.ownerId),
    index("deals_status_idx").on(t.status),
  ],
);

export const dealLineItems = pgTable(
  "deal_line_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    kind: lineItemKind("kind").notNull(),
    description: text("description"),
    unitPrice: numeric("unit_price", { precision: 14, scale: 4, mode: "number" }).notNull(),
    // Committed quantity per billing period (e.g. 5 agent seats). 0 for pure usage-based rates.
    quantity: numeric("quantity", { precision: 14, scale: 2, mode: "number" }).notNull().default(1),
    includedFree: numeric("included_free", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
    billingCycle: billingCycle("billing_cycle").notNull().default("monthly"),
    // Optional volume slabs, e.g. [{ upTo: 1000, unitPrice: 2 }, { upTo: null, unitPrice: 1.5 }]
    tiers: jsonb("tiers").$type<{ upTo: number | null; unitPrice: number }[]>(),
    position: integer("position").notNull().default(0),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("deal_line_items_deal_idx").on(t.dealId)],
);

export const onboardings = pgTable(
  "onboardings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    dealId: uuid("deal_id").references(() => deals.id),
    stageId: integer("stage_id")
      .notNull()
      .references(() => stages.id),
    omId: uuid("om_id").references(() => users.id),
    kickoffDate: date("kickoff_date"),
    goLiveDate: date("go_live_date"),
    health: health("health"),
    nps: integer("nps"),
    voiceAdoption: text("voice_adoption"),
    notes: text("notes"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("onboardings_org_idx").on(t.orgId),
    // At most one onboarding in flight per organization.
    uniqueIndex("onboardings_one_open_per_org").on(t.orgId).where(sql`completed_at is null`),
  ],
);

export const activities = pgTable(
  "activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: activityType("type").notNull(),
    subject: text("subject").notNull(),
    body: text("body"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ownerId: uuid("owner_id").references(() => users.id),
    orgId: uuid("org_id").references(() => organizations.id),
    dealId: uuid("deal_id").references(() => deals.id, { onDelete: "set null" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    createdById: uuid("created_by_id").references(() => users.id),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index("activities_org_idx").on(t.orgId),
    index("activities_deal_idx").on(t.dealId),
    index("activities_contact_idx").on(t.contactId),
    // "My work": a user's open tasks (completed_at is null) by due date.
    index("activities_owner_open_idx").on(t.ownerId, t.completedAt, t.dueAt),
  ],
);

// Append-only audit log. Powers record timelines and every "date entered stage X" report.
export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    orgId: uuid("org_id"),
    actorId: uuid("actor_id").references(() => users.id),
    action: text("action").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index("events_entity_idx").on(t.entityType, t.entityId, t.createdAt),
    index("events_org_idx").on(t.orgId, t.createdAt),
  ],
);

// Per-consumer API keys for /api/v1 and the MCP server. Only the sha256 of the key is stored;
// the key itself is shown once, when an admin creates it. Calls act as the owner user.
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    scopes: apiKeyScope("scopes").array().notNull().default(sql`'{read}'::api_key_scope[]`),
    keyHash: text("key_hash").notNull(),
    // First characters of the key (not secret), so people can tell keys apart.
    keyPrefix: text("key_prefix").notNull(),
    createdById: uuid("created_by_id").references(() => users.id),
    createdAt: timestamps.createdAt,
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("api_keys_key_hash_uq").on(t.keyHash), index("api_keys_owner_idx").on(t.ownerId)],
);

export type User = typeof users.$inferSelect;
export type Organization = typeof organizations.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type Stage = typeof stages.$inferSelect;
export type Deal = typeof deals.$inferSelect;
export type DealLineItem = typeof dealLineItems.$inferSelect;
export type Onboarding = typeof onboardings.$inferSelect;
export type Activity = typeof activities.$inferSelect;
export type Event = typeof events.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;

// A named, filtered list (the query string of e.g. /leads), private or shared with everyone.
export const savedViews = pgTable(
  "saved_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    module: text("module").notNull(),
    name: text("name").notNull(),
    query: text("query").notNull().default(""),
    shared: boolean("shared").notNull().default(false),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("saved_views_module_idx").on(t.module, t.ownerId)],
);

export type SavedView = typeof savedViews.$inferSelect;

export const notificationStatus = pgEnum("notification_status", ["pending", "sending", "sent", "failed", "skipped"]);

/**
 * Outbox for Slack notifications. Rows are written in the same transaction as the change that
 * causes them (a win, a churn), then sent by the dispatcher; `dedupe_key` stops repeats (a deal won
 * twice after a reopen, or the daily digest running twice).
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    // "deals" / "alerts" (channels from env), "user:<email>" (a DM), or "create_channel".
    target: text("target").notNull(),
    orgId: uuid("org_id").references(() => organizations.id),
    dedupeKey: text("dedupe_key").notNull().unique(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: notificationStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("notifications_due_idx").on(t.status, t.nextAttemptAt)],
);

export type Notification = typeof notifications.$inferSelect;

/**
 * Outbound webhooks (Settings → Webhooks). Every audit-log entry that maps to a published event
 * (src/domain/webhooks.ts) becomes one delivery per subscribed endpoint, sent and retried like the
 * Slack outbox. The secret signs each delivery; consumers verify it.
 */
export const webhookEndpoints = pgTable("webhook_endpoints", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  // Event keys, or ["*"] for everything.
  events: text("events").array().notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdById: uuid("created_by_id").references(() => users.id),
  createdAt: timestamps.createdAt,
});

export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect;

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    endpointId: uuid("endpoint_id")
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: notificationStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    responseStatus: integer("response_status"),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("webhook_deliveries_due_idx").on(t.status, t.nextAttemptAt), index("webhook_deliveries_endpoint_idx").on(t.endpointId, t.createdAt)],
);

/**
 * Managed picklist values (Settings → Fields). One row per value per field; the catalogue of fields
 * and their seed values is src/domain/fields.ts. Records store the value itself, so renaming an
 * option rewrites the records that use it; retiring one keeps it valid on old records but stops
 * offering it.
 */
export const fieldOptions = pgTable(
  "field_options",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    field: text("field").notNull(),
    value: text("value").notNull(),
    position: integer("position").notNull().default(0),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    createdAt: timestamps.createdAt,
  },
  (t) => [uniqueIndex("field_options_field_value_uq").on(t.field, t.value)],
);

export type FieldOption = typeof fieldOptions.$inferSelect;

/**
 * Gmail sync (Settings → Email). One connected mailbox per user, with its refresh token sealed
 * (src/domain/secret-box.ts) and the Gmail history id to sync from.
 */
export const mailAccounts = pgTable("mail_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  refreshTokenSealed: text("refresh_token_sealed").notNull(),
  historyId: text("history_id"),
  // active, paused (by its owner), error (sync failing; see last_error), revoked (Google said no)
  status: text("status").notNull().default("active"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastError: text("last_error"),
  messagesLogged: integer("messages_logged").notNull().default(0),
  connectedAt: timestamps.createdAt,
});

export type MailAccount = typeof mailAccounts.$inferSelect;

/**
 * Every email logged from Gmail. `message_id` (the RFC Message-ID) is unique, so a thread with two
 * reps on it is logged once. Only headers and a short snippet are kept, never the body.
 */
export const emailMessages = pgTable(
  "email_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageId: text("message_id").notNull().unique(),
    gmailId: text("gmail_id").notNull(),
    threadId: text("thread_id"),
    accountId: uuid("account_id").references(() => mailAccounts.id, { onDelete: "set null" }),
    direction: text("direction").notNull(),
    subject: text("subject").notNull(),
    snippet: text("snippet"),
    fromEmail: text("from_email").notNull(),
    participants: jsonb("participants").$type<{ email: string; name: string | null }[]>().notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
    activityId: uuid("activity_id").references(() => activities.id, { onDelete: "set null" }),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "set null" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("email_messages_org_idx").on(t.orgId, t.sentAt), index("email_messages_contact_idx").on(t.contactId, t.sentAt)],
);

/** Never-log list for Gmail sync: a domain ("vendor.com") or an address ("someone@gmail.com"). */
export const mailExclusions = pgTable("mail_exclusions", {
  id: uuid("id").primaryKey().defaultRandom(),
  value: text("value").notNull().unique(),
  createdById: uuid("created_by_id").references(() => users.id),
  createdAt: timestamps.createdAt,
});
