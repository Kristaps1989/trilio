CREATE TABLE "social_images" (
	"post_id" uuid NOT NULL,
	"n" integer NOT NULL,
	"shape" text NOT NULL,
	"card_hash" text NOT NULL,
	"jpeg" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_images_post_id_n_shape_pk" PRIMARY KEY("post_id","n","shape")
);
--> statement-breakpoint
CREATE TABLE "tv_exposures" (
	"slug" text NOT NULL,
	"household" text NOT NULL,
	"minute" timestamp with time zone NOT NULL,
	"grp" text DEFAULT 'ad' NOT NULL,
	"source" text NOT NULL,
	"hits" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "tv_exposures_slug_household_minute_grp_pk" PRIMARY KEY("slug","household","minute","grp")
);
--> statement-breakpoint
CREATE TABLE "tv_household_visits" (
	"slug" text NOT NULL,
	"household" text NOT NULL,
	"minute" timestamp with time zone NOT NULL,
	"day" date NOT NULL,
	"visitor_hash" text NOT NULL,
	CONSTRAINT "tv_household_visits_slug_household_minute_visitor_hash_pk" PRIMARY KEY("slug","household","minute","visitor_hash")
);
--> statement-breakpoint
CREATE TABLE "tv_pixel_addresses" (
	"slug" text NOT NULL,
	"day" date NOT NULL,
	"source" text NOT NULL,
	"address_hash" text NOT NULL,
	CONSTRAINT "tv_pixel_addresses_slug_day_source_address_hash_pk" PRIMARY KEY("slug","day","source","address_hash")
);
--> statement-breakpoint
CREATE TABLE "tv_pixel_counts" (
	"slug" text NOT NULL,
	"day" date NOT NULL,
	"key" text NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "tv_pixel_counts_slug_day_key_pk" PRIMARY KEY("slug","day","key")
);
--> statement-breakpoint
ALTER TABLE "affiliate_clicks" ADD COLUMN "client" text;--> statement-breakpoint
ALTER TABLE "search_sessions" ADD COLUMN "suspect" text;--> statement-breakpoint
ALTER TABLE "tv_uplift" ADD COLUMN "households" jsonb;--> statement-breakpoint
ALTER TABLE "tv_viewers" ADD COLUMN "impressions" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "ui_events" ADD COLUMN "suspect" text;--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "suspect" text;--> statement-breakpoint
ALTER TABLE "social_images" ADD CONSTRAINT "social_images_post_id_social_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."social_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tv_exposures" ADD CONSTRAINT "tv_exposures_slug_tv_campaigns_slug_fk" FOREIGN KEY ("slug") REFERENCES "public"."tv_campaigns"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tv_household_visits" ADD CONSTRAINT "tv_household_visits_slug_tv_campaigns_slug_fk" FOREIGN KEY ("slug") REFERENCES "public"."tv_campaigns"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tv_pixel_addresses" ADD CONSTRAINT "tv_pixel_addresses_slug_tv_campaigns_slug_fk" FOREIGN KEY ("slug") REFERENCES "public"."tv_campaigns"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tv_pixel_counts" ADD CONSTRAINT "tv_pixel_counts_slug_tv_campaigns_slug_fk" FOREIGN KEY ("slug") REFERENCES "public"."tv_campaigns"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tv_exposures_minute_idx" ON "tv_exposures" USING btree ("slug","minute");--> statement-breakpoint
CREATE INDEX "tv_household_visits_minute_idx" ON "tv_household_visits" USING btree ("slug","minute");--> statement-breakpoint
CREATE INDEX "search_sessions_suspect_idx" ON "search_sessions" USING btree ("created_at") WHERE "search_sessions"."suspect" is not null;--> statement-breakpoint
CREATE INDEX "ui_events_suspect_idx" ON "ui_events" USING btree ("day") WHERE "ui_events"."suspect" is not null;--> statement-breakpoint
CREATE INDEX "visits_visitor_idx" ON "visits" USING btree ("visitor_hash","day");--> statement-breakpoint
CREATE INDEX "visits_suspect_idx" ON "visits" USING btree ("day") WHERE "visits"."suspect" is not null;