CREATE TYPE "public"."partner_request_status" AS ENUM('requested', 'confirmed', 'unavailable');--> statement-breakpoint
CREATE TABLE "lead_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"note" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"order_id" uuid,
	"status" "partner_request_status" DEFAULT 'requested' NOT NULL,
	"partner" text,
	"partner_order_ref" text,
	"cost_cents" integer,
	"note" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_requests" ADD CONSTRAINT "partner_requests_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_requests" ADD CONSTRAINT "partner_requests_order_id_offer_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."offer_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_notes_product_idx" ON "lead_notes" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "partner_requests_product_idx" ON "partner_requests" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "partner_requests_order_idx" ON "partner_requests" USING btree ("order_id");