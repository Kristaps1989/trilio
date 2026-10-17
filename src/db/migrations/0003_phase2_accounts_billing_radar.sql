CREATE TYPE "public"."payment_kind" AS ENUM('initial', 'renewal');--> statement-breakpoint
CREATE TYPE "public"."payment_provider" AS ENUM('paysera', 'mock');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'captured', 'failed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."plan_interval" AS ENUM('month', 'year');--> statement-breakpoint
CREATE TYPE "public"."radar_scope" AS ENUM('only', 'brand', 'any');--> statement-breakpoint
CREATE TYPE "public"."radar_threshold" AS ENUM('any', '5', '10');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('pending', 'active', 'past_due', 'canceled', 'expired');--> statement-breakpoint
CREATE TABLE "accounts" (
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "payment_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"notification_id" text NOT NULL,
	"event" text,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"order_id" text NOT NULL,
	"provider_request_id" text,
	"kind" "payment_kind" NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"paid_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"price_cents" integer NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"interval" "plan_interval" NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "radar_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"radar_id" uuid NOT NULL,
	"offer_id" uuid,
	"product_id" uuid,
	"kind" text NOT NULL,
	"old_price_cents" integer,
	"new_price_cents" integer NOT NULL,
	"channels" text[] DEFAULT '{}'::text[] NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"search_session_id" uuid,
	"threshold" "radar_threshold" DEFAULT 'any' NOT NULL,
	"scope" "radar_scope" DEFAULT 'only' NOT NULL,
	"store_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"include_refurbished" boolean DEFAULT false NOT NULL,
	"channels" text[] DEFAULT '{email}'::text[] NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"baseline_price_cents" integer,
	"last_notified_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_id" text NOT NULL,
	"status" "subscription_status" DEFAULT 'pending' NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"token_encrypted" text,
	"payment_method_label" text,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"next_billing_at" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"canceled_at" timestamp with time zone,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"email_verified" timestamp with time zone,
	"image" text,
	"locale" text DEFAULT 'lv' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radar_events" ADD CONSTRAINT "radar_events_radar_id_radars_id_fk" FOREIGN KEY ("radar_id") REFERENCES "public"."radars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radar_events" ADD CONSTRAINT "radar_events_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radar_events" ADD CONSTRAINT "radar_events_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radars" ADD CONSTRAINT "radars_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radars" ADD CONSTRAINT "radars_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radars" ADD CONSTRAINT "radars_search_session_id_search_sessions_id_fk" FOREIGN KEY ("search_session_id") REFERENCES "public"."search_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_notifications_provider_id_idx" ON "payment_notifications" USING btree ("provider","notification_id");--> statement-breakpoint
CREATE INDEX "payments_subscription_idx" ON "payments" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "radar_events_radar_time_idx" ON "radar_events" USING btree ("radar_id","sent_at");--> statement-breakpoint
CREATE INDEX "radars_user_idx" ON "radars" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "radars_product_idx" ON "radars" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "subscriptions_user_idx" ON "subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "subscriptions_billing_idx" ON "subscriptions" USING btree ("status","next_billing_at");