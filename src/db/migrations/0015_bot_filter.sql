CREATE TABLE "bot_hits" (
	"day" date NOT NULL,
	"kind" text NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "bot_hits_day_kind_pk" PRIMARY KEY("day","kind")
);
--> statement-breakpoint
ALTER TABLE "affiliate_clicks" ADD COLUMN "visitor_hash" text;--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "client" text;--> statement-breakpoint
CREATE INDEX "affiliate_clicks_visitor_idx" ON "affiliate_clicks" USING btree ("visitor_hash","offer_id");