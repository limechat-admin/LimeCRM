CREATE TABLE "campaign_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"contact_id" uuid,
	"email" text NOT NULL,
	"vars" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"skip_reason" text,
	"postmark_message_id" text,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"opens" integer DEFAULT 0 NOT NULL,
	"clicked_at" timestamp with time zone,
	"clicks" integer DEFAULT 0 NOT NULL,
	"bounced_at" timestamp with time zone,
	"bounce_type" text,
	"complained_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"list_id" uuid,
	"subscription_type" text DEFAULT 'product_updates' NOT NULL,
	"from_name" text NOT NULL,
	"from_email" text NOT NULL,
	"reply_to" text,
	"subject" text DEFAULT '' NOT NULL,
	"preheader" text,
	"blocks" jsonb NOT NULL,
	"scheduled_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_preferences" (
	"email" text PRIMARY KEY NOT NULL,
	"unsubscribed_all" boolean DEFAULT false NOT NULL,
	"opted_out" text[] DEFAULT '{}'::text[] NOT NULL,
	"suppressed" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_list_id_email_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."email_lists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_lists" ADD CONSTRAINT "email_lists_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_recipients_campaign_email_uq" ON "campaign_recipients" USING btree ("campaign_id","email");--> statement-breakpoint
CREATE INDEX "campaign_recipients_queue_idx" ON "campaign_recipients" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "campaign_recipients_message_idx" ON "campaign_recipients" USING btree ("postmark_message_id");--> statement-breakpoint
CREATE INDEX "campaign_recipients_contact_idx" ON "campaign_recipients" USING btree ("contact_id");