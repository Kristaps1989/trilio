-- Posts that went out on one network but were later marked "skipped" as late
-- (their other half failed and was retried): they are live there, so published,
-- with a note on the network that is missing (docs/SOCIAL_PLAN.md §12, 7 Nov 2026).
UPDATE "social_posts"
SET "status" = 'published',
    "error" = CASE
      WHEN "fb_post_id" IS NOT NULL AND "ig_media_id" IS NULL THEN 'Instagram: nokavēts, netika publicēts.'
      WHEN "ig_media_id" IS NOT NULL AND "fb_post_id" IS NULL THEN 'Facebook: nokavēts, netika publicēts.'
      ELSE "error"
    END
WHERE "status" = 'skipped'
  AND ("fb_post_id" IS NOT NULL OR "ig_media_id" IS NOT NULL)
  AND "error" LIKE 'Nokavēts%';
