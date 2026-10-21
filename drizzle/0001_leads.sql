ALTER TABLE "contacts" ADD COLUMN "linkedin_url" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "partner_name" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "product_interest" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "bant_budget" integer;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "bant_authority" integer;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "bant_need" integer;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "bant_timeline" integer;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "meeting_scheduled_at" date;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "meeting_completed_at" date;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "qualified_at" date;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "sql_at" date;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "disqualified_reason" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "website_traffic_range" text;--> statement-breakpoint
CREATE INDEX "contacts_lead_status_idx" ON "contacts" USING btree ("lead_status");--> statement-breakpoint
CREATE INDEX "contacts_owner_idx" ON "contacts" USING btree ("owner_id");