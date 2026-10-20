CREATE TABLE "eprel_lookups" (
	"product_id" uuid PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"method" text,
	"product_group" text,
	"registration_number" text,
	"record" jsonb,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "eprel_lookups" ADD CONSTRAINT "eprel_lookups_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;