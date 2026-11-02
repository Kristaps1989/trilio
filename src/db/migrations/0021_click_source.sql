ALTER TABLE "affiliate_clicks" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "affiliate_clicks" ADD COLUMN "internal" boolean DEFAULT false NOT NULL;