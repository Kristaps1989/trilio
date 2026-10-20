CREATE TYPE "public"."saved_item_kind" AS ENUM('product', 'search');--> statement-breakpoint
CREATE TABLE "notify_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"threshold" "radar_threshold" DEFAULT '5' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "saved_item_kind" NOT NULL,
	"key" text NOT NULL,
	"product_id" uuid,
	"subcategory_id" text NOT NULL,
	"answers_param" text,
	"label" text,
	"baseline_price_cents" integer,
	"last_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notify_settings" ADD CONSTRAINT "notify_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_items" ADD CONSTRAINT "saved_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_items" ADD CONSTRAINT "saved_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "saved_items_user_key_idx" ON "saved_items" USING btree ("user_id","key");--> statement-breakpoint
CREATE INDEX "saved_items_user_idx" ON "saved_items" USING btree ("user_id");