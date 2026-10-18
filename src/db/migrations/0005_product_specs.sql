ALTER TABLE "products" ADD COLUMN "attribute_sources" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "spec_table" jsonb;