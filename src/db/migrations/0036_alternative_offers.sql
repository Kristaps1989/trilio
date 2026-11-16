CREATE TABLE "offer_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"set_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"bytes" "bytea" NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"alt" text NOT NULL,
	"source" text NOT NULL,
	"source_url" text,
	"added_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"product_id" uuid NOT NULL,
	"user_id" uuid,
	"notify_request_id" uuid,
	"email" text NOT NULL,
	"outcome" text NOT NULL,
	"reason" text,
	"offer_id" uuid,
	"shop_cents" integer,
	"note" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone,
	"answer" text,
	"answered_at" timestamp with time zone,
	CONSTRAINT "request_outcomes_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "partner_requests" ADD COLUMN "wait_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "special_offers" ADD COLUMN "alternative_to_product_id" uuid;--> statement-breakpoint
ALTER TABLE "special_offers" ADD COLUMN "alternative_to_name" text;--> statement-breakpoint
ALTER TABLE "special_offers" ADD COLUMN "comparison" jsonb;--> statement-breakpoint
ALTER TABLE "special_offers" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "special_offers" ADD COLUMN "image_set_id" uuid;--> statement-breakpoint
ALTER TABLE "special_offers" ADD COLUMN "manual_product" jsonb;--> statement-breakpoint
ALTER TABLE "special_offers" ADD COLUMN "declined_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "request_outcomes" ADD CONSTRAINT "request_outcomes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_outcomes" ADD CONSTRAINT "request_outcomes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_outcomes" ADD CONSTRAINT "request_outcomes_notify_request_id_notify_requests_id_fk" FOREIGN KEY ("notify_request_id") REFERENCES "public"."notify_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_outcomes" ADD CONSTRAINT "request_outcomes_offer_id_special_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."special_offers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "offer_images_set_idx" ON "offer_images" USING btree ("set_id","position");--> statement-breakpoint
CREATE INDEX "request_outcomes_product_idx" ON "request_outcomes" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "request_outcomes_user_idx" ON "request_outcomes" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "special_offers" ADD CONSTRAINT "special_offers_alternative_to_product_id_products_id_fk" FOREIGN KEY ("alternative_to_product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;