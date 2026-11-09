ALTER TABLE "notify_requests" ADD COLUMN "activated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "saved_items" ADD COLUMN "alerts_until" timestamp with time zone DEFAULT now() + interval '90 days' NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_items" ADD COLUMN "renewal_sent_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "saved_items_alerts_until_idx" ON "saved_items" USING btree ("alerts_until");