# Runbook

Operational notes for Trilio. Everything here is reversible and recorded in the database.

## Local setup

```bash
cp .env.example .env.local          # fill DATABASE_URL and CRON_SECRET
npm ci
npm run db:migrate                  # applies src/db/migrations
npm run db:seed                     # stores + data/sample-products.json
npm run dev
```

Checks a contributor runs before pushing: `npm run typecheck && npm run lint && npm run format:check && npm test && npm run build && npm run test:e2e`.

## Partner feeds

Shops are rows in `stores`. Nothing about a shop is in code except the slug used by the seed.

### Add or activate a store

1. Get from the partner: the feed URL (Google Shopping XML or CSV), the affiliate link template, and their category names for the categories we handle.
2. Update the row (psql or the DB console):
   ```sql
   update stores set
     feed_type = 'google_xml',                           -- or 'csv'
     feed_url = 'https://feeds.partner.lv/trilio.xml',
     feed_allowed_hosts = '{cdn.partner.lv}',            -- extra hosts redirects may go to
     affiliate_template_url = 'https://go.network.example/c?u={url}',
     category_map = '{"Ledusskapji":"fridge","Veļas mašīnas":"washer"}',
     image_hosts = '{partner.lv,*.partner.lv}',
     active = true
   where slug = 'euronics';
   ```
   `category_map` keys are matched case-insensitively against the feed's `product_type` (full path or last segment). Categories we do not map are skipped, which is expected: most of a shop's catalogue is outside our scope. Unmapped labels show up in `ingestion_runs` rejections and in the CLI output, so start with an empty map, run once, and fill the map from what was rejected.
3. Dry-run against a file the partner sent, before the URL goes live:
   ```bash
   npm run ingest -- euronics path/to/their-sample.xml
   ```
4. Run for real: `npm run ingest -- euronics` (uses `feed_url`), or `npm run ingest -- all`.
5. Add the image hosts to `images.remotePatterns` in `next.config.ts` (the only code change per store; it is a security allow-list).

### Shops without a feed

euronics.lv, m79.lv and tet.lv are read from their public product pages (`feed_type = 'scrape'`). How it works, its limits, and how to add a shop are in `docs/SCRAPING.md`. On a database seeded before scraping existed, activate them once:

```sql
update stores set active = true where slug in ('euronics', 'm79', 'tet');
-- once real offers exist, hide the placeholder sample stores:
update stores set active = false where feed_type = 'sample';
```

A scraped store's `ingestion_runs` row shows how far it got; the CLI also prints `pagesFetched` and `stopReason` (`http_429`, `cloudflare_challenge`, `time_budget`, …). A stop reason other than `time_budget` means the shop pushed back: leave the store alone and contact the shop rather than retrying harder.

### Scheduled ingestion

On Railway a cron service runs `npm run ingest -- all` every 4 hours (see `docs/DEPLOY_RAILWAY.md` §5). `POST /api/cron/ingest` with `Authorization: Bearer $CRON_SECRET` does the same over HTTP for any external scheduler. Each run writes a `price_snapshots` row per offer, so the 30-day low is available from the first run.

Rotate the secret: set a new `CRON_SECRET` in the hosting environment, redeploy, update the scheduler. The old value stops working immediately.

### What the fetcher refuses

HTTP (not HTTPS) URLs, hosts outside `feed_url`'s host plus `feed_allowed_hosts`, hosts resolving to private or loopback addresses, more than 3 redirects, bodies over 50 MB, XML with a DOCTYPE or entity declarations. These are deliberate (SSRF and XXE guards); if a partner's feed hits one, change the feed, not the guard.

### Re-run or inspect

```sql
select s.slug, r.started_at, r.ok, r.rows_read, r.rows_upserted, r.rows_rejected, r.error
from ingestion_runs r join stores s on s.id = r.store_id
order by r.started_at desc limit 20;
```

Offers not seen in a feed for 24 hours are marked `out` (for a partial scrape run, after `staleAfterHours`); they are never deleted, so price history stays intact.

## Database

- Migrations: edit `src/db/schema.ts`, then `npm run db:generate` (creates `src/db/migrations/NNNN_*.sql`), review the SQL, commit it, and `npm run db:migrate` in each environment. CI applies migrations to a fresh Postgres on every run.
- Never edit an applied migration; add a new one.
- Backups: provider daily snapshots; keep a weekly logical dump in EU object storage once in production.

## Secrets

All secrets are environment variables listed in `.env.example`. None are committed. The CSP, HSTS and other headers are in `src/proxy.ts` and `next.config.ts`; a Playwright test fails if they disappear.
