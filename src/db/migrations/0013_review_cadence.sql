CREATE TYPE "public"."ad_review_cadence" AS ENUM('weekly', 'daily');--> statement-breakpoint
ALTER TABLE "ad_settings" ADD COLUMN "review_cadence" "ad_review_cadence" DEFAULT 'weekly' NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_settings" ADD COLUMN "review_weekday" integer DEFAULT 1 NOT NULL;