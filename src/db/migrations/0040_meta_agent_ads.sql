CREATE TABLE "meta_agent_ads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ad_id" text NOT NULL,
	"subcategory_id" text NOT NULL,
	"name" text NOT NULL,
	"facts" jsonb NOT NULL,
	"message" text NOT NULL,
	"headline" text NOT NULL,
	"link" text NOT NULL,
	"image_hash" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	"retired_why" text,
	CONSTRAINT "meta_agent_ads_ad_id_unique" UNIQUE("ad_id")
);
--> statement-breakpoint
CREATE INDEX "meta_agent_ads_sub_idx" ON "meta_agent_ads" USING btree ("subcategory_id","status");