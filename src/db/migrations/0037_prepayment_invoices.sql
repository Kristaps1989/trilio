ALTER TYPE "public"."invoice_kind" ADD VALUE 'prepayment';--> statement-breakpoint
DROP INDEX "invoices_year_seq_idx";--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "series" text DEFAULT 'TR' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "payment_method" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "basis_number" text;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_series_year_seq_idx" ON "invoices" USING btree ("series","year","seq");