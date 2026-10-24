CREATE TYPE "public"."ad_campaign_kind" AS ENUM('search', 'pmax');--> statement-breakpoint
CREATE TYPE "public"."ad_creative_status" AS ENUM('draft', 'approved', 'rejected', 'uploaded');--> statement-breakpoint
CREATE TYPE "public"."ad_match" AS ENUM('exact', 'phrase', 'broad');--> statement-breakpoint
CREATE TYPE "public"."ad_mode" AS ENUM('observe', 'approve', 'auto');--> statement-breakpoint
CREATE TYPE "public"."ad_proposal_status" AS ENUM('proposed', 'applied', 'rejected', 'blocked', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ad_status" AS ENUM('draft', 'enabled', 'paused', 'removed');--> statement-breakpoint
CREATE TABLE "ad_ads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ad_group_id" uuid NOT NULL,
	"google_id" text,
	"headlines" jsonb NOT NULL,
	"descriptions" jsonb NOT NULL,
	"final_path" text NOT NULL,
	"status" "ad_status" DEFAULT 'draft' NOT NULL,
	"source" text DEFAULT 'seed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"day" date NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"ok" boolean DEFAULT false NOT NULL,
	"summary" text,
	"memo" text,
	"proposals" integer DEFAULT 0 NOT NULL,
	"applied" integer DEFAULT 0 NOT NULL,
	"blocked" integer DEFAULT 0 NOT NULL,
	"error" text,
	"owner_note" text
);
--> statement-breakpoint
CREATE TABLE "ad_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"google_id" text,
	"budget_google_id" text,
	"name" text NOT NULL,
	"kind" "ad_campaign_kind" DEFAULT 'search' NOT NULL,
	"group_id" text NOT NULL,
	"status" "ad_status" DEFAULT 'draft' NOT NULL,
	"budget_cents" integer DEFAULT 0 NOT NULL,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ad_campaigns_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "ad_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid,
	"operation" jsonb NOT NULL,
	"ok" boolean NOT NULL,
	"response" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_creatives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"subcategory_id" text NOT NULL,
	"size" text,
	"headline" text NOT NULL,
	"body" text NOT NULL,
	"script" jsonb,
	"status" "ad_creative_status" DEFAULT 'draft' NOT NULL,
	"google_asset_id" text,
	"source" text DEFAULT 'template' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_daily_stats" (
	"day" date NOT NULL,
	"level" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	"conversions" real DEFAULT 0 NOT NULL,
	CONSTRAINT "ad_daily_stats_day_level_entity_id_pk" PRIMARY KEY("day","level","entity_id")
);
--> statement-breakpoint
CREATE TABLE "ad_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"google_id" text,
	"subcategory_id" text NOT NULL,
	"name" text NOT NULL,
	"landing_path" text NOT NULL,
	"cpc_cap_cents" integer DEFAULT 30 NOT NULL,
	"status" "ad_status" DEFAULT 'draft' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_keywords" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"ad_group_id" uuid,
	"google_id" text,
	"text" text NOT NULL,
	"match" "ad_match" DEFAULT 'phrase' NOT NULL,
	"negative" boolean DEFAULT false NOT NULL,
	"status" "ad_status" DEFAULT 'draft' NOT NULL,
	"source" text DEFAULT 'seed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_landings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day" date NOT NULL,
	"visitor_hash" text NOT NULL,
	"gclid" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_term" text,
	"path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid,
	"action" text NOT NULL,
	"params" jsonb NOT NULL,
	"reason" text NOT NULL,
	"expected_effect" text,
	"confidence" integer,
	"status" "ad_proposal_status" DEFAULT 'proposed' NOT NULL,
	"block_reason" text,
	"decided_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ad_search_terms" (
	"day" date NOT NULL,
	"ad_group_id" uuid NOT NULL,
	"term" text NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	"conversions" real DEFAULT 0 NOT NULL,
	"label" text,
	CONSTRAINT "ad_search_terms_day_ad_group_id_term_pk" PRIMARY KEY("day","ad_group_id","term")
);
--> statement-breakpoint
CREATE TABLE "ad_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"daily_budget_cents" integer DEFAULT 1500 NOT NULL,
	"floor_cents" integer DEFAULT 500 NOT NULL,
	"target_cost_cents" integer,
	"click_weight" integer DEFAULT 1 NOT NULL,
	"save_weight" integer DEFAULT 3 NOT NULL,
	"mode" "ad_mode" DEFAULT 'approve' NOT NULL,
	"auto_actions" jsonb DEFAULT '["add_negative","pause_keyword"]'::jsonb NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_queries" (
	"day" date NOT NULL,
	"query" text NOT NULL,
	"page" text NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"position" real DEFAULT 0 NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	CONSTRAINT "seo_queries_day_query_page_pk" PRIMARY KEY("day","query","page")
);
--> statement-breakpoint
ALTER TABLE "affiliate_clicks" ADD COLUMN "ad_landing_id" uuid;--> statement-breakpoint
ALTER TABLE "saved_items" ADD COLUMN "ad_landing_id" uuid;--> statement-breakpoint
ALTER TABLE "ad_ads" ADD CONSTRAINT "ad_ads_ad_group_id_ad_groups_id_fk" FOREIGN KEY ("ad_group_id") REFERENCES "public"."ad_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_changes" ADD CONSTRAINT "ad_changes_proposal_id_ad_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."ad_proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_groups" ADD CONSTRAINT "ad_groups_campaign_id_ad_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."ad_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_keywords" ADD CONSTRAINT "ad_keywords_campaign_id_ad_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."ad_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_keywords" ADD CONSTRAINT "ad_keywords_ad_group_id_ad_groups_id_fk" FOREIGN KEY ("ad_group_id") REFERENCES "public"."ad_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_proposals" ADD CONSTRAINT "ad_proposals_run_id_ad_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ad_agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_search_terms" ADD CONSTRAINT "ad_search_terms_ad_group_id_ad_groups_id_fk" FOREIGN KEY ("ad_group_id") REFERENCES "public"."ad_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ad_agent_runs_kind_day_idx" ON "ad_agent_runs" USING btree ("kind","day");--> statement-breakpoint
CREATE UNIQUE INDEX "ad_groups_campaign_sub_idx" ON "ad_groups" USING btree ("campaign_id","subcategory_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ad_keywords_unique_idx" ON "ad_keywords" USING btree ("campaign_id","ad_group_id","text","match","negative");--> statement-breakpoint
CREATE INDEX "ad_landings_visitor_idx" ON "ad_landings" USING btree ("day","visitor_hash");--> statement-breakpoint
CREATE INDEX "ad_landings_day_idx" ON "ad_landings" USING btree ("day");--> statement-breakpoint
CREATE INDEX "ad_proposals_status_idx" ON "ad_proposals" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "affiliate_clicks" ADD CONSTRAINT "affiliate_clicks_ad_landing_id_ad_landings_id_fk" FOREIGN KEY ("ad_landing_id") REFERENCES "public"."ad_landings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_items" ADD CONSTRAINT "saved_items_ad_landing_id_ad_landings_id_fk" FOREIGN KEY ("ad_landing_id") REFERENCES "public"."ad_landings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "affiliate_clicks_ad_idx" ON "affiliate_clicks" USING btree ("ad_landing_id");