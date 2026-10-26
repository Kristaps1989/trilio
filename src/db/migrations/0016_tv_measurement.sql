CREATE TABLE "tv_campaigns" (
	"slug" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"landing_path" text DEFAULT '/' NOT NULL,
	"salt" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tv_daily" (
	"slug" text NOT NULL,
	"day" date NOT NULL,
	"kind" text NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "tv_daily_slug_day_kind_pk" PRIMARY KEY("slug","day","kind")
);
--> statement-breakpoint
CREATE TABLE "tv_viewers" (
	"slug" text NOT NULL,
	"day" date NOT NULL,
	"viewer_hash" text NOT NULL,
	CONSTRAINT "tv_viewers_slug_day_viewer_hash_pk" PRIMARY KEY("slug","day","viewer_hash")
);
--> statement-breakpoint
ALTER TABLE "tv_daily" ADD CONSTRAINT "tv_daily_slug_tv_campaigns_slug_fk" FOREIGN KEY ("slug") REFERENCES "public"."tv_campaigns"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tv_viewers" ADD CONSTRAINT "tv_viewers_slug_tv_campaigns_slug_fk" FOREIGN KEY ("slug") REFERENCES "public"."tv_campaigns"("slug") ON DELETE cascade ON UPDATE no action;