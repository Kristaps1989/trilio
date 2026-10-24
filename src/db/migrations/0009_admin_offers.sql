CREATE TYPE "public"."buyer_kind" AS ENUM('person', 'company');--> statement-breakpoint
CREATE TYPE "public"."delivery_method" AS ENUM('courier', 'locker');--> statement-breakpoint
CREATE TYPE "public"."invoice_kind" AS ENUM('invoice', 'credit_note');--> statement-breakpoint
CREATE TYPE "public"."offer_status" AS ENUM('draft', 'sent', 'opened', 'accepted', 'paid', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('awaiting_payment', 'paid', 'packed', 'shipped', 'delivered', 'return_requested', 'returned', 'refunded', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."payment_kind" ADD VALUE 'order';--> statement-breakpoint
CREATE TABLE "admin_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_email" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"details" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "invoice_kind" DEFAULT 'invoice' NOT NULL,
	"number" text NOT NULL,
	"year" integer NOT NULL,
	"seq" integer NOT NULL,
	"order_id" uuid NOT NULL,
	"credit_for_id" uuid,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seller" jsonb NOT NULL,
	"buyer" jsonb NOT NULL,
	"lines" jsonb NOT NULL,
	"net_cents" integer NOT NULL,
	"vat_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"vat_rate" integer,
	CONSTRAINT "invoices_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "offer_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"order_id" uuid,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"note" text,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offer_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"user_id" uuid,
	"number" text NOT NULL,
	"status" "order_status" DEFAULT 'awaiting_payment' NOT NULL,
	"amount_cents" integer NOT NULL,
	"buyer_kind" "buyer_kind" DEFAULT 'person' NOT NULL,
	"full_name" text NOT NULL,
	"phone" text,
	"email" text NOT NULL,
	"street" text,
	"city" text,
	"postcode" text,
	"country" text DEFAULT 'LV' NOT NULL,
	"delivery_method" "delivery_method" DEFAULT 'courier' NOT NULL,
	"locker_id" text,
	"locker_name" text,
	"carry_in" boolean DEFAULT false NOT NULL,
	"delivery_note" text,
	"company_name" text,
	"company_reg_no" text,
	"company_vat_no" text,
	"legal_address" text,
	"terms_accepted_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"carrier" text,
	"tracking_number" text,
	"tracking_url" text,
	"packed_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"delivery_confirmed_by" text,
	"last_tracked_at" timestamp with time zone,
	"return_requested_at" timestamp with time zone,
	"returned_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"refund_reference" text,
	"feedback_token" text NOT NULL,
	"feedback_asked_at" timestamp with time zone,
	"feedback" text,
	"feedback_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offer_orders_offer_id_unique" UNIQUE("offer_id"),
	CONSTRAINT "offer_orders_number_unique" UNIQUE("number"),
	CONSTRAINT "offer_orders_feedback_token_unique" UNIQUE("feedback_token")
);
--> statement-breakpoint
CREATE TABLE "special_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"user_id" uuid,
	"product_id" uuid,
	"product_name" text NOT NULL,
	"subcategory_id" text NOT NULL,
	"condition" "condition" DEFAULT 'new' NOT NULL,
	"grade" text,
	"warranty_months" integer DEFAULT 24 NOT NULL,
	"price_cents" integer NOT NULL,
	"reference_price_cents" integer,
	"reference_low30_cents" integer,
	"reference_store_name" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"delivery_working_days" integer DEFAULT 3 NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"message" text,
	"supplier_note" text,
	"cost_cents" integer,
	"status" "offer_status" DEFAULT 'draft' NOT NULL,
	"batch_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"reminded_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "special_offers_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "visit_daily" (
	"day" date NOT NULL,
	"path" text NOT NULL,
	"section" text NOT NULL,
	"subcategory" text,
	"views" integer NOT NULL,
	"visitors" integer NOT NULL,
	CONSTRAINT "visit_daily_day_path_pk" PRIMARY KEY("day","path")
);
--> statement-breakpoint
CREATE TABLE "visit_salts" (
	"day" date PRIMARY KEY NOT NULL,
	"salt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day" date NOT NULL,
	"path" text NOT NULL,
	"section" text NOT NULL,
	"subcategory" text,
	"visitor_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "subscription_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "offer_order_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "offers_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "offers_opt_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "offers_token" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "admin_note" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_offer_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."offer_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_events" ADD CONSTRAINT "offer_events_offer_id_special_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."special_offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_events" ADD CONSTRAINT "offer_events_order_id_offer_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."offer_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_orders" ADD CONSTRAINT "offer_orders_offer_id_special_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."special_offers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_orders" ADD CONSTRAINT "offer_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "special_offers" ADD CONSTRAINT "special_offers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "special_offers" ADD CONSTRAINT "special_offers_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_created_idx" ON "admin_audit" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_year_seq_idx" ON "invoices" USING btree ("year","seq");--> statement-breakpoint
CREATE INDEX "offer_events_offer_idx" ON "offer_events" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX "offer_orders_status_idx" ON "offer_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "offer_orders_user_idx" ON "offer_orders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "special_offers_user_idx" ON "special_offers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "special_offers_status_idx" ON "special_offers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "visits_day_idx" ON "visits" USING btree ("day");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_offer_order_id_offer_orders_id_fk" FOREIGN KEY ("offer_order_id") REFERENCES "public"."offer_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_offers_token_unique" UNIQUE("offers_token");