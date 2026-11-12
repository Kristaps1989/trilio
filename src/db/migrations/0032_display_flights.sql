ALTER TABLE "tv_campaigns" ADD COLUMN "kind" text DEFAULT 'tv' NOT NULL;--> statement-breakpoint
ALTER TABLE "tv_campaigns" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "tv_campaigns" ADD COLUMN "flight_salt" text;--> statement-breakpoint
ALTER TABLE "tv_campaigns" ADD COLUMN "flight_with" text;--> statement-breakpoint
ALTER TABLE "tv_campaigns" ADD COLUMN "flight_at" timestamp with time zone;