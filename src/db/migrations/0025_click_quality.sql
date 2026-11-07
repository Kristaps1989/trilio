ALTER TABLE "affiliate_clicks" ADD COLUMN "signals" jsonb;--> statement-breakpoint
ALTER TABLE "affiliate_clicks" ADD COLUMN "suspect" text;--> statement-breakpoint
ALTER TABLE "search_sessions" ADD COLUMN "visitor_hash" text;--> statement-breakpoint
CREATE INDEX "search_sessions_visitor_idx" ON "search_sessions" USING btree ("visitor_hash","created_at");