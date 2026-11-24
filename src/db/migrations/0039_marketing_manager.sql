CREATE TABLE "marketing_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day" date NOT NULL,
	"kind" text NOT NULL,
	"entity_id" text,
	"detail" jsonb NOT NULL,
	"reason" text NOT NULL,
	"applied" boolean DEFAULT false NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta_ad_daily" (
	"day" date NOT NULL,
	"ad_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"spend_cents" integer DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"link_clicks" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "meta_ad_daily_day_ad_id_pk" PRIMARY KEY("day","ad_id")
);
--> statement-breakpoint
CREATE TABLE "meta_ad_entities" (
	"id" text PRIMARY KEY NOT NULL,
	"level" text NOT NULL,
	"name" text NOT NULL,
	"campaign_id" text,
	"adset_id" text,
	"status" text NOT NULL,
	"effective_status" text NOT NULL,
	"daily_budget_cents" integer,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ad_landings" ADD COLUMN "utm_content" text;--> statement-breakpoint
ALTER TABLE "ad_settings" ADD COLUMN "meta_managed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_settings" ADD COLUMN "meta_daily_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "marketing_actions_day_idx" ON "marketing_actions" USING btree ("day");