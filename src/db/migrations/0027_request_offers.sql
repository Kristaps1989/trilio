ALTER TABLE "special_offers" ADD COLUMN "notify_request_id" uuid;--> statement-breakpoint
ALTER TABLE "special_offers" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "special_offers" ADD CONSTRAINT "special_offers_notify_request_id_notify_requests_id_fk" FOREIGN KEY ("notify_request_id") REFERENCES "public"."notify_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "special_offers_request_idx" ON "special_offers" USING btree ("notify_request_id");