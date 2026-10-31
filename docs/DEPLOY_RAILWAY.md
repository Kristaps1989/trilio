# Deploying Trilio on Railway

Everything Railway needs is in the repo: `railway.json` (build, start with migrations, healthcheck), `/api/health`, and the ingestion job, which the web service schedules itself. The only things you enter in Railway are environment variables.

## 1. Create the project

1. Railway → **New Project** → **Deploy from GitHub repo** → `kristaps1989/trilio`, branch `main` (or the branch you want deployed).
2. In the project, **+ New → Database → PostgreSQL**. Railway names it `Postgres` and sets its variables.
3. Set the project's **Region** to `EU West (Amsterdam)` (Settings → Region) before the first deploy. Data must stay in the EU (GDPR); changing region later moves the volume.

## 2. Web service variables

Open the web service → **Variables** → add:

| Variable | Value | Notes |
|---|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Reference variable; uses Railway's private network, no SSL needed. |
| `CRON_SECRET` | `openssl rand -hex 32` output | Protects `/api/cron/ingest`. |
| `MARKET` | `LV` | `LT`/`EE` for those deployments (`docs/LOCALES.md`). |
| `ENERGY_PRICE_CENTS_PER_KWH` | `25` | Optional; default 0,25 €/kWh. |
| `ANTHROPIC_API_KEY` | from console.anthropic.com | Only needed when either LLM flag is on; see `docs/LLM.md`. |
| `LLM_MODEL` | `claude-opus-5-5` | Optional override. |
| `LLM_DAILY_CALL_CAP` | `2000` | Per purpose per day; exceeding it degrades gracefully. |
| `FEATURE_FREE_TEXT_LLM` | `0` | `1` routes "Kaut kas cits" text through Claude when the regex table finds nothing. |
| `FEATURE_LLM_EXTRACT` | `0` | `1` fills product attributes/tags from feed text after each scheduled ingestion run. |
| `APP_URL` | `https://trilio.lv` | Public URL; payment callback/redirects and auth URLs are built from it. |
| `GOOGLE_SITE_VERIFICATION` | from Search Console (HTML tag method) | Optional; adds the verification meta tag. |
| `COMPANY_NAME`, `COMPANY_REG_NO`, `COMPANY_ADDRESS`, `COMPANY_EMAIL` | your company's registry details | Shown on the legal pages and on Trilio's invoices; required by Latvian law. `COMPANY_VAT_NO` only once VAT-registered: invoices then show 21 % VAT automatically. `COMPANY_EMAIL` also receives order notes (new order, withdrawal, problem). |
| `GA_MEASUREMENT_ID` | `G-…` from Google Analytics | Optional. Turns on the consent banner and opt-in analytics (`docs/ANALYTICS.md`). |
| `FEATURE_ADS` | `0` | `1` turns on the admin section "Reklāma" and the daily ads optimiser (`docs/GROWTH_PLAN.md`). Needs `ANTHROPIC_API_KEY` for the Claude parts. |
| `FEATURE_SOCIAL` | `0` | `1` turns on Facebook and Instagram posts (Admin → Sociālie tīkli, `docs/SOCIAL_PLAN.md`). Needs `META_PAGE_ID`, `META_IG_USER_ID` and `META_SYSTEM_USER_TOKEN`; `SOCIAL_PROVIDER=mock` posts nowhere. `ANTHROPIC_API_KEY` is optional (Claude's first line for picks and advice posts). |
| `GOOGLE_SERVICE_ACCOUNT_KEY`, `GOOGLE_ADS_CUSTOMER_ID` | the JSON key of the sign-in Cloud project's service account; the 10-digit ads account id | Steps in `docs/ADS_SETUP.md`. No developer token or manager account is needed since Google's change of 9 Sep 2026. `GOOGLE_ADS_LOGIN_CUSTOMER_ID` only when a manager account is used. |
| `GOOGLE_ADS_TAG_ID`, `GOOGLE_ADS_CONVERSION_SHOP_CLICK`, `GOOGLE_ADS_CONVERSION_SAVE` | `AW-…` from Google Ads; the conversion labels | The Google Ads tag, loaded only after cookie consent. Steps in `docs/ADS_SETUP.md` §5. |
| `GOOGLE_ADS_API_VERSION` | empty (default `v26`) | Optional; change only after checking Google's sunset dates. |
| `SEARCH_CONSOLE_SITE` | `sc-domain:trilio.lv` | Optional; fills the SEO page from Search Console. |
| `ADMIN_EMAILS` | the e-mail you sign in with | Who may open `/admin` (comma-separated). Empty = nobody (`docs/ADMIN_AND_OFFERS_PLAN.md`). |
| `OFFERS_SENDER_NAME` | `Kristaps` | Optional; personal-offer e-mails are signed "Kristaps no Trilio". Default "Trilio". |
| `OMNIVA_API_URL`, `OMNIVA_USERNAME`, `OMNIVA_PASSWORD` | from your Omniva account manager | Optional; automatic delivery tracking for Omniva parcels. Without them the admin or the buyer marks delivery. |
| `AUTH_SECRET` | `openssl rand -base64 32` | Session signing (Auth.js). |
| `AUTH_URL` | same as `APP_URL` | |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | from Google Cloud console | Enables "Turpināt ar Google". Steps: `docs/AUTH_SETUP.md`. |
| `RESEND_API_KEY`, `EMAIL_FROM` | from resend.com | Magic-link sign-in, receipts and radar emails. Steps: `docs/AUTH_SETUP.md`. |
| `PAYSERA_MAC_ID` / `PAYSERA_MAC_KEY` / `PAYSERA_BUSINESS_ID` | from Paysera after approval | One-off payments for personal offers (`docs/PAYMENTS.md`). |
| `PAYMENT_TOKEN_KEY` | `openssl rand -hex 32` | Encrypts stored billing tokens. |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | `npx web-push generate-vapid-keys` | Web push. |
| `AUTH_DEV_LOGIN`, `PAYMENTS_PROVIDER=mock`, `ADS_PROVIDER=mock`, `ALLOW_INSECURE_TEST_FEATURES` | **never set on Railway** | Dev/CI only. |
| `NODE_ENV` | `production` | Railway sets this during build; set it explicitly for runtime too. |

Every integration is optional: a provider whose variables are missing is simply not offered (no Google button without Google credentials, no payments without Paysera credentials, no email without Resend).

Railway injects `PORT`; `next start` binds to it automatically on `0.0.0.0`.

## 3. First deploy

Railway builds with Railpack (`npm install`, `npm run build`), then starts the service with `npm run start:release`: it runs `npm run db:release` against `DATABASE_URL` and then `next start`. Railway waits for `/api/health` to return 200, which needs both the database connection and the migrated schema. A failed migration or health check leaves the previous deployment running. (Migrations used to run as a Railway pre-deploy command; on the first production deploy that step left the database empty, so they now run in the start command, where their output is in the deploy log.)

`npm run db:release` applies migrations and seeds the partner stores (with their crawl config and category maps). It runs on every deploy and is safe to repeat: store settings in `src/db/stores.ts` reach production with the next deploy, while the `active` flag, feed URLs and affiliate templates you change in the database are kept. Production never gets the placeholder sample shops (`SEED_SAMPLE_DATA=0`).

### If the deploy fails

- **Build step:** the build needs no database or secrets (CI builds the same way). Category landing pages, `robots.txt`, `sitemap.xml` and `llms.txt` are rendered at runtime, so they always use the runtime `APP_URL`.
- **Start (`npm run db:release`) fails with "DATABASE_URL is not set":** the web service is missing the `DATABASE_URL` reference variable. Add `DATABASE_URL=${{Postgres.DATABASE_URL}}` under the web service's **Variables** (the Postgres service must be in the same project), then redeploy.
- **`npm install` reports vulnerabilities:** Railway audits the full dependency tree, including build-only tools. `npm audit --omit=dev` (what ships) reports none.

## 4. Custom domain and TLS

Web service → **Settings → Networking → Custom Domain** → `trilio.lv` (and `www.trilio.lv`). Add the CNAME Railway shows at the DNS provider. Railway issues the certificate. HSTS is already sent by the app (`next.config.ts`), so only put the domain live once HTTPS resolves.

**`www.trilio.lv`** must redirect to `trilio.lv` (the production smoke test checks it). In Cloudflare:

1. **DNS → Add record**: type `CNAME`, name `www`, target `trilio.lv`, proxy status **Proxied** (orange cloud).
2. **Rules → Redirect Rules → Create rule** ("Redirect from WWW to root" template): when hostname equals `www.trilio.lv`, dynamic redirect to `concat("https://trilio.lv", http.request.uri.path)`, status **301**, preserve the query string.

The redirect happens at Cloudflare, so Railway needs no extra custom domain for `www`.

## 4a. Search engines and AI assistants

The app already serves `robots.txt` (search engines and the major AI crawlers are allowed on public pages; results, accounts, payments and affiliate redirects are closed), `sitemap.xml` (all category and budget landing pages) and `llms.txt` (a plain-text site map for AI assistants). Pages carry Open Graph tags and JSON-LD (`Organization`, `WebSite`, `BreadcrumbList`, `ItemList`, `FAQPage`).

After the domain is live:

1. Google Search Console → add `trilio.lv` → HTML tag method → copy the token into `GOOGLE_SITE_VERIFICATION` and redeploy → verify → submit `https://trilio.lv/sitemap.xml`.
2. Bing Webmaster Tools → import from Search Console (covers Bing, DuckDuckGo and ChatGPT search).
3. Check `https://trilio.lv/robots.txt` and `https://trilio.lv/llms.txt` render as expected.

## 5. Scheduled ingestion

**Nothing to set up.** On Railway's `production` environment the web service runs the job itself (`src/services/jobs/scheduler.ts`, started from `src/instrumentation.ts`).

- **When it runs.** A minute after start, and then every 15 minutes, it checks which shops are due. Each shop has its own schedule: it is due when its last finished run is four hours old and no run of it is going.
- **What it does.** It reads the due shops (euronics.lv, m79.lv, tet.lv), stores new prices and price history, sends price radar alerts and purges old waitlist entries.
- **Progress.** The web service logs show `ingest: starting …`, then `ingest m79: 400/2000 pages, 371 offers saved` every 100 pages, then `ingest scheduler: done` with a summary per shop.

`INGEST_SCHEDULE=off` on the web service turns this off; `INGEST_SCHEDULE=on` turns it on in any other environment.

**Deploys are safe during ingestion.** Offers are saved every 100 pages, so a redeploy loses at most about three minutes of reading. On SIGTERM a running scrape stops, saves what it read and closes its run. If a process dies without closing its run (crash, out of memory), that run stops counting once the shop's time budget (`maxRunMinutes` + 15 min) has passed. The shop is then picked up at the next check. Other shops are never held back by it.

### Optional: a separate cron service

To keep scraping out of the web process, run the same job as a second Railway service, then set `INGEST_SCHEDULE=off` on the web service. If both run, a shop that one of them is reading, or read in the last four hours, is skipped by the other.

1. In the project, **+ New → GitHub Repo** → the same repository and branch. Rename the new service to `ingest`.
2. Service → **Settings → Config-as-code → Railway config file**: `/railway.cron.json`. That file sets the start command `npm run ingest -- all`, the schedule `17 */4 * * *` (every four hours, 17 minutes past), and turns off the web build, health check and restarts. Without this setting the service uses `railway.json` and starts a second copy of the website instead.
3. Service → **Variables**:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
   | `APP_URL` | same as the web service, e.g. `https://trilio.lv` |
   | `RESEND_API_KEY`, `EMAIL_FROM` | same as the web service (radar alert emails) |
   | `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | same as the web service, once web push is set up |
   | `ANTHROPIC_API_KEY`, `FEATURE_LLM_EXTRACT` | only if attribute extraction is on (`docs/LLM.md`) |

4. Deploy. The service then waits for its schedule. To run it at once: service → **Deployments → ⋯ → Run now**. `npm run ingest -- all --force` reads every shop now, due or not.

A full pass over all shops takes about three hours, because pages are read one at a time at a polite pace (`docs/SCRAPING.md`). Each shop is read for at most its `maxRunMinutes` per run, and catalogues larger than one run rotate (unseen and oldest pages first).

Results are in the service logs and in the `ingestion_runs` and `radar_events` tables.

**Is ingestion working?** Open `https://trilio.lv/api/status`. It lists each active shop with its in-stock offer count and its last ingestion run (start, finish, ok, rows saved). `"ingestHasRun": false` means no run has started yet: the first one starts about a minute after the web service boots on the `production` environment. If it stays false, check the web service logs for `ingest scheduler`. A run that started but has no `finishedAt` is still going. Its `rowsUpserted` grows every 100 pages, and those products are on the site already.

**Billing cron (only once payments are on):** add a third service from the same repository, set its Railway config file to `/railway.billing.json` (daily at 06:00 UTC, runs `npm run cron:billing`), and give it `APP_URL` and `CRON_SECRET`, the same values as the web service. It charges due renewals and retries (`docs/PAYMENTS.md`).

`/api/cron/ingest` on the web service does the same work over HTTP (`Authorization: Bearer $CRON_SECRET`) for any external scheduler you prefer, except scraped shops: those run only in the scheduler or the cron service, because they take far longer than an HTTP request may.

## 6. Environments

Railway environments map to branches. Suggested:

- `production` ← `main`
- `staging` ← `claude/optimistic-curie-qujwng` (or a `develop` branch), with its own Postgres plugin and its own `CRON_SECRET`.

Enable **Settings → Deploy → Wait for CI** on the production service so a deploy only starts after the GitHub Actions workflow passes on that commit.

## 7. Operations

- **Logs**: service → Observability. Ingestion rejections show the feed category labels you still need to map (see `docs/RUNBOOK.md`).
- **Backups**: Postgres service → **Backups** → enable daily. Keep a weekly `pg_dump` elsewhere once revenue depends on it.
- **Rollback**: Deployments → previous deployment → **Redeploy**. Migrations are forward-only; a rollback of code that needs a dropped column will fail its health check, which is the intended safety net.
- **Secrets rotation**: change the variable in Railway; a redeploy picks it up.
- **Monitoring**: the **Smoke (production)** GitHub workflow (`.github/workflows/smoke.yml`, suite in `tests/smoke`) opens every sitemap URL, walks the guided flow to a shop click, and checks sign-in, `robots.txt`, `sitemap.xml`, `llms.txt`, `/api/health` and the `http` and `www` redirects. It runs after each successful Railway deployment, every hour, and on demand (Actions → Smoke → Run workflow). It only reads. A failure turns the run red, and GitHub emails the repository owner. Run it locally with `SMOKE_BASE_URL=https://trilio.lv npm run test:smoke`.
- **Scaling**: `numReplicas` in `railway.json`, or Settings → Replicas. The app is stateless; sessions and radar state live in Postgres.

## What the repo config does

| File | Purpose |
|---|---|
| `railway.json` | Web service: Railpack build, `npm run start:release` (migrations and store/plan seed, then `next start`), healthcheck on `/api/health`, restart on failure. |
| `railway.cron.json` | Ingest cron service: no web build, `npm run ingest -- all` every four hours. |
| `railway.billing.json` | Billing cron service: no web build, `npm run cron:billing` daily. |
| `src/app/api/health/route.ts` | 200 when the database answers within 5 s, else 503. |
| `src/services/jobs/scheduler.ts` | Four-hourly ingestion inside the web service. |
| `src/services/ingestion/cli.ts` | Entry point for the optional cron service. |
| `package.json` `engines` | Pins Node 22 so Railpack picks the same runtime as CI. |
