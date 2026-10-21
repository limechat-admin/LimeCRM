CREATE TYPE "public"."activity_type" AS ENUM('call', 'task', 'meeting', 'demo', 'email', 'linkedin', 'whatsapp', 'note', 'attempted_contact');--> statement-breakpoint
CREATE TYPE "public"."billing_cycle" AS ENUM('monthly', 'quarterly', 'semi_annual', 'annual', 'one_time');--> statement-breakpoint
CREATE TYPE "public"."churn_category" AS ENUM('payment', 'business', 'onboarding_experience', 'low_value', 'support_issues', 'competition_product', 'competition_pricing', 'corporate_changes', 'did_not_start', 'self_serve', 'product_gaps', 'partner_churn');--> statement-breakpoint
CREATE TYPE "public"."currency" AS ENUM('INR', 'USD');--> statement-breakpoint
CREATE TYPE "public"."deal_status" AS ENUM('open', 'won', 'lost');--> statement-breakpoint
CREATE TYPE "public"."deal_type" AS ENUM('new_business', 'upsell', 'cross_sell', 'renewal', 'addendum');--> statement-breakpoint
CREATE TYPE "public"."health" AS ENUM('green', 'yellow', 'red');--> statement-breakpoint
CREATE TYPE "public"."lifecycle" AS ENUM('prospect', 'onboarding', 'active', 'on_hold', 'churned');--> statement-breakpoint
CREATE TYPE "public"."line_item_kind" AS ENUM('platform_fee', 'agent_seat', 'bot_session', 'wa_marketing', 'wa_utility', 'voice_minute', 'inbound_calling', 'outbound_calling', 'sms', 'email', 'image_ai', 'implementation_fee', 'other');--> statement-breakpoint
CREATE TYPE "public"."pipeline_key" AS ENUM('sales', 'onboarding');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."segment" AS ENUM('enterprise', 'mid_market', 'growth_dedicated', 'growth_self_serve');--> statement-breakpoint
CREATE TYPE "public"."stage_kind" AS ENUM('open', 'won', 'lost', 'hold');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'sales', 'onboarding', 'cs', 'finance', 'viewer');--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "activity_type" NOT NULL,
	"subject" text NOT NULL,
	"body" text,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"owner_id" uuid,
	"org_id" uuid,
	"deal_id" uuid,
	"contact_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"designation" text,
	"is_decision_maker" boolean DEFAULT false NOT NULL,
	"lead_status" text,
	"lead_stage" text,
	"source" text,
	"owner_id" uuid,
	"sdr_id" uuid,
	"salesmate_contact_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"kind" "line_item_kind" NOT NULL,
	"description" text,
	"unit_price" numeric(14, 4) NOT NULL,
	"quantity" numeric(14, 2) DEFAULT 1 NOT NULL,
	"included_free" numeric(14, 2) DEFAULT 0 NOT NULL,
	"billing_cycle" "billing_cycle" DEFAULT 'monthly' NOT NULL,
	"tiers" jsonb,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"primary_contact_id" uuid,
	"title" text NOT NULL,
	"type" "deal_type" DEFAULT 'new_business' NOT NULL,
	"stage_id" integer NOT NULL,
	"status" "deal_status" DEFAULT 'open' NOT NULL,
	"owner_id" uuid,
	"sdr_id" uuid,
	"source" text,
	"partner_name" text,
	"plan" text,
	"products" text[] DEFAULT '{}'::text[] NOT NULL,
	"priority" "priority",
	"expected_close_date" date,
	"closed_at" timestamp with time zone,
	"ended_at" date,
	"lost_reason" text,
	"lost_detail" text,
	"billing_cycle" "billing_cycle",
	"currency" "currency" DEFAULT 'INR' NOT NULL,
	"contract_start" date,
	"contract_renewal" date,
	"contract_link" text,
	"requires_onboarding" boolean DEFAULT true NOT NULL,
	"mrr" numeric(14, 2) DEFAULT 0 NOT NULL,
	"one_time_fee" numeric(14, 2) DEFAULT 0 NOT NULL,
	"salesmate_deal_ids" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"org_id" uuid,
	"actor_id" uuid,
	"action" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboardings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"deal_id" uuid,
	"stage_id" integer NOT NULL,
	"om_id" uuid,
	"kickoff_date" date,
	"go_live_date" date,
	"health" "health",
	"nps" integer,
	"voice_adoption" text,
	"notes" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"website" text,
	"segment" "segment",
	"industry" text,
	"hq_city" text,
	"lifecycle" "lifecycle" DEFAULT 'prospect' NOT NULL,
	"ae_id" uuid,
	"om_id" uuid,
	"csm_id" uuid,
	"lc_account_ids" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"chargebee_customer_id" text,
	"client_channel" text,
	"health" "health",
	"health_note" text,
	"contracted_mrr" numeric(14, 2) DEFAULT 0 NOT NULL,
	"churned_at" date,
	"churn_category" "churn_category",
	"churn_reason" text,
	"churn_last_billing_date" date,
	"salesmate_company_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stages" (
	"id" serial PRIMARY KEY NOT NULL,
	"pipeline" "pipeline_key" NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"kind" "stage_kind" DEFAULT 'open' NOT NULL,
	"win_probability" integer,
	"required_fields" text[] DEFAULT '{}'::text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" DEFAULT 'viewer' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_sdr_id_users_id_fk" FOREIGN KEY ("sdr_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_line_items" ADD CONSTRAINT "deal_line_items_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_primary_contact_id_contacts_id_fk" FOREIGN KEY ("primary_contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_stage_id_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_sdr_id_users_id_fk" FOREIGN KEY ("sdr_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboardings" ADD CONSTRAINT "onboardings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboardings" ADD CONSTRAINT "onboardings_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboardings" ADD CONSTRAINT "onboardings_stage_id_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboardings" ADD CONSTRAINT "onboardings_om_id_users_id_fk" FOREIGN KEY ("om_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_ae_id_users_id_fk" FOREIGN KEY ("ae_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_om_id_users_id_fk" FOREIGN KEY ("om_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_csm_id_users_id_fk" FOREIGN KEY ("csm_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_org_idx" ON "activities" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "activities_deal_idx" ON "activities" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "contacts_org_idx" ON "contacts" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "contacts_email_idx" ON "contacts" USING btree ("email");--> statement-breakpoint
CREATE INDEX "deal_line_items_deal_idx" ON "deal_line_items" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "deals_org_idx" ON "deals" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "deals_stage_idx" ON "deals" USING btree ("stage_id");--> statement-breakpoint
CREATE INDEX "deals_owner_idx" ON "deals" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "deals_status_idx" ON "deals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "events_entity_idx" ON "events" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "events_org_idx" ON "events" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "onboardings_org_idx" ON "onboardings" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "onboardings_one_open_per_org" ON "onboardings" USING btree ("org_id") WHERE completed_at is null;--> statement-breakpoint
CREATE INDEX "organizations_lifecycle_idx" ON "organizations" USING btree ("lifecycle");--> statement-breakpoint
CREATE INDEX "organizations_name_idx" ON "organizations" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "stages_pipeline_key_uq" ON "stages" USING btree ("pipeline","key");