CREATE TABLE "notify_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"email" text NOT NULL,
	"kind" "saved_item_kind" NOT NULL,
	"product_id" uuid,
	"subcategory_id" text NOT NULL,
	"answers_param" text,
	"label" text,
	"return_path" text,
	"locale" text DEFAULT 'lv' NOT NULL,
	"consent" text NOT NULL,
	"offers" boolean DEFAULT false NOT NULL,
	"visitor_hash" text,
	"ad_landing_id" uuid,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"signed_in_at" timestamp with time zone,
	CONSTRAINT "notify_requests_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "ui_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day" date NOT NULL,
	"visitor_hash" text NOT NULL,
	"event" text NOT NULL,
	"subcategory_id" text,
	"ad_landing_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notify_requests" ADD CONSTRAINT "notify_requests_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notify_requests" ADD CONSTRAINT "notify_requests_ad_landing_id_ad_landings_id_fk" FOREIGN KEY ("ad_landing_id") REFERENCES "public"."ad_landings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notify_requests" ADD CONSTRAINT "notify_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ui_events" ADD CONSTRAINT "ui_events_ad_landing_id_ad_landings_id_fk" FOREIGN KEY ("ad_landing_id") REFERENCES "public"."ad_landings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notify_requests_email_idx" ON "notify_requests" USING btree ("email","created_at");--> statement-breakpoint
CREATE INDEX "notify_requests_visitor_idx" ON "notify_requests" USING btree ("visitor_hash","created_at");--> statement-breakpoint
CREATE INDEX "ui_events_day_idx" ON "ui_events" USING btree ("day","event");