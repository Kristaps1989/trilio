ALTER TABLE "users" ADD COLUMN "offers_asked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "price_alerts" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "alerts_token" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_alerts_token_unique" UNIQUE("alerts_token");