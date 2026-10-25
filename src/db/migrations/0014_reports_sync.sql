ALTER TABLE "ad_settings" ADD COLUMN "reports_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ad_settings" ADD COLUMN "reports_error" text;