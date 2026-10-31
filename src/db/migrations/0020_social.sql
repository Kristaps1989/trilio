CREATE TYPE "public"."social_post_status" AS ENUM('draft', 'approved', 'published', 'skipped', 'failed');--> statement-breakpoint
CREATE TABLE "social_insights" (
	"post_id" uuid NOT NULL,
	"network" text NOT NULL,
	"day" date NOT NULL,
	"reach" integer DEFAULT 0 NOT NULL,
	"reactions" integer DEFAULT 0 NOT NULL,
	"comments" integer DEFAULT 0 NOT NULL,
	"shares" integer DEFAULT 0 NOT NULL,
	"link_clicks" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "social_insights_post_id_network_day_pk" PRIMARY KEY("post_id","network","day")
);
--> statement-breakpoint
CREATE TABLE "social_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"slot_at" timestamp with time zone NOT NULL,
	"status" "social_post_status" DEFAULT 'draft' NOT NULL,
	"subcategory_id" text,
	"product_id" uuid,
	"special_offer_id" uuid,
	"card" jsonb NOT NULL,
	"caption_fb" text NOT NULL,
	"caption_ig" text NOT NULL,
	"alt" text NOT NULL,
	"link" text NOT NULL,
	"video_url" text,
	"source" text DEFAULT 'template' NOT NULL,
	"fb_post_id" text,
	"ig_media_id" text,
	"error" text,
	"created_by" text NOT NULL,
	"approved_by" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "social_insights" ADD CONSTRAINT "social_insights_post_id_social_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."social_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_special_offer_id_special_offers_id_fk" FOREIGN KEY ("special_offer_id") REFERENCES "public"."special_offers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "social_posts_slot_idx" ON "social_posts" USING btree ("slot_at");--> statement-breakpoint
CREATE INDEX "social_posts_status_idx" ON "social_posts" USING btree ("status");