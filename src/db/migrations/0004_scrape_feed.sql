ALTER TYPE "public"."feed_type" ADD VALUE 'scrape';--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "scrape_config" jsonb;