CREATE TABLE "confidence_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"search_session_id" uuid,
	"subcategory_id" text NOT NULL,
	"confident" boolean NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "rating_x10" integer;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "rating_count" integer;--> statement-breakpoint
ALTER TABLE "confidence_answers" ADD CONSTRAINT "confidence_answers_search_session_id_search_sessions_id_fk" FOREIGN KEY ("search_session_id") REFERENCES "public"."search_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "confidence_answers_created_idx" ON "confidence_answers" USING btree ("created_at");