CREATE TABLE "tv_impressions" (
	"slug" text NOT NULL,
	"minute" timestamp with time zone NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "tv_impressions_slug_minute_pk" PRIMARY KEY("slug","minute")
);
--> statement-breakpoint
CREATE TABLE "tv_uplift" (
	"slug" text NOT NULL,
	"day" date NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"tv_buckets" integer DEFAULT 0 NOT NULL,
	"sessions_day" integer DEFAULT 0 NOT NULL,
	"sessions_after" integer DEFAULT 0 NOT NULL,
	"expected_after" real,
	"uplift" real,
	"results_after" integer DEFAULT 0 NOT NULL,
	"clicks_after" integer DEFAULT 0 NOT NULL,
	"phone_after" integer DEFAULT 0 NOT NULL,
	"correlation" real,
	"buckets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tv_uplift_slug_day_pk" PRIMARY KEY("slug","day")
);
--> statement-breakpoint
ALTER TABLE "tv_campaigns" ADD COLUMN "baseline" jsonb;--> statement-breakpoint
ALTER TABLE "tv_impressions" ADD CONSTRAINT "tv_impressions_slug_tv_campaigns_slug_fk" FOREIGN KEY ("slug") REFERENCES "public"."tv_campaigns"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tv_uplift" ADD CONSTRAINT "tv_uplift_slug_tv_campaigns_slug_fk" FOREIGN KEY ("slug") REFERENCES "public"."tv_campaigns"("slug") ON DELETE cascade ON UPDATE no action;