ALTER TABLE "tv_viewers" ADD COLUMN "account_hash" text;--> statement-breakpoint
ALTER TABLE "tv_viewers" ADD COLUMN "child" boolean;--> statement-breakpoint
CREATE INDEX "tv_viewers_account_idx" ON "tv_viewers" USING btree ("slug","account_hash");