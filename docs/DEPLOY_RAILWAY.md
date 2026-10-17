# Deploying Trilio on Railway

Everything Railway needs is in the repo: `railway.json` (build, pre-deploy migrations, start, healthcheck), `/api/health`, and the ingestion CLI for the cron service. The only things you enter in Railway are environment variables.

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
| `FEATURE_LLM_EXTRACT` | `0` | `1` fills product attributes/tags from feed text after each ingestion run (also on the cron service). |
| `APP_URL` | `https://trilio.lv` | Public URL; payment callback/redirects and auth URLs are built from it. |
| `GOOGLE_SITE_VERIFICATION` | from Search Console (HTML tag method) | Optional; adds the verification meta tag. |
| `AUTH_SECRET` | `openssl rand -base64 32` | Session signing (Auth.js). |
| `AUTH_URL` | same as `APP_URL` | |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | from Google Cloud console | Enables "Turpināt ar Google". |
| `AUTH_APPLE_ID` / `AUTH_APPLE_SECRET` | from Apple developer | Enables "Turpināt ar Apple". |
| `RESEND_API_KEY`, `EMAIL_FROM` | from resend.com | Magic-link sign-in, receipts and radar emails. |
| `PAYSERA_MAC_ID` / `PAYSERA_MAC_KEY` / `PAYSERA_BUSINESS_ID` | from Paysera after approval | Recurring billing (`docs/PAYMENTS.md`). |
| `PAYMENT_TOKEN_KEY` | `openssl rand -hex 32` | Encrypts stored billing tokens. |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | `npx web-push generate-vapid-keys` | Web push. |
| `AUTH_DEV_LOGIN`, `PAYMENTS_PROVIDER=mock`, `ALLOW_INSECURE_TEST_FEATURES` | **never set on Railway** | Dev/CI only. |
| `NODE_ENV` | `production` | Railway sets this during build; set it explicitly for runtime too. |

Every integration is optional: a provider whose variables are missing is simply not offered (no Google button without Google credentials, no payments without Paysera credentials, no email without Resend).

Railway injects `PORT`; `next start` binds to it automatically on `0.0.0.0`.

## 3. First deploy

Railway builds with Railpack (`npm ci`, `npm run build`), then runs the **pre-deploy command** `npm run db:migrate` against `DATABASE_URL`, then starts `npm run start` and waits for `/api/health` to return 200 (it checks the database connection). A failed migration or health check leaves the previous deployment running.

Seed the database once, after the first successful deploy, from the service shell (service → **⋯ → Shell**) or locally with the **public** `DATABASE_URL` from the Postgres service:

```bash
npm run db:seed
```

This writes the store rows (sample stores active, partner shops inactive) and the sample products. Re-running it is safe.

## 4. Custom domain and TLS

Web service → **Settings → Networking → Custom Domain** → `trilio.lv` (and `www.trilio.lv`). Add the CNAME Railway shows at the DNS provider. Railway issues the certificate. HSTS is already sent by the app (`next.config.ts`), so only put the domain live once HTTPS resolves.

## 4a. Search engines and AI assistants

The app already serves `robots.txt` (search engines and the major AI crawlers are allowed on public pages; results, accounts, payments and affiliate redirects are closed), `sitemap.xml` (all category and budget landing pages) and `llms.txt` (a plain-text site map for AI assistants). Pages carry Open Graph tags and JSON-LD (`Organization`, `WebSite`, `BreadcrumbList`, `ItemList`, `FAQPage`).

After the domain is live:

1. Google Search Console → add `trilio.lv` → HTML tag method → copy the token into `GOOGLE_SITE_VERIFICATION` and redeploy → verify → submit `https://trilio.lv/sitemap.xml`.
2. Bing Webmaster Tools → import from Search Console (covers Bing, DuckDuckGo and ChatGPT search).
3. Check `https://trilio.lv/robots.txt` and `https://trilio.lv/llms.txt` render as expected.

## 5. Scheduled ingestion (cron service)

Railway cron services run a command on a schedule and expect it to exit. Create one that reuses the same repo:

1. **+ New → GitHub Repo** → same repo and branch. Name it `ingest`.
2. **Settings → Cron Schedule**: `17 */4 * * *` (every 4 hours, off the hour).
3. **Settings → Deploy → Custom Start Command**: `npm run ingest -- all`
4. **Settings → Deploy → Pre-deploy command**: clear it (the web service owns migrations).
5. **Settings → Deploy → Healthcheck path**: clear it (a cron job has no HTTP server).
6. **Variables**: `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `NODE_ENV=production`, `APP_URL` (same as the web service; the crawler's User-Agent and radar emails use it).

A run takes about three hours, because euronics.lv, m79.lv and tet.lv are read page by page at a polite pace (`docs/SCRAPING.md`). Railway skips a cron start while the previous run is still going, so the four-hour schedule is safe; if more shops are scraped, move to a six-hour schedule (`17 */6 * * *`).

Each run ingests every active non-sample store, extracts attributes (if enabled), evaluates every price radar and sends notifications, then exits; results are in the service logs and in the `ingestion_runs` / `radar_events` tables.

Add a second cron service for billing: schedule `0 6 * * *`, start command `curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" $APP_URL/api/cron/billing`, variables `CRON_SECRET` and `APP_URL`. It charges due renewals and retries (`docs/PAYMENTS.md`). To run on demand: service → **Deployments → ⋯ → Run now**, or `npm run ingest -- euronics` from a shell.

`/api/cron/ingest` on the web service does the same work over HTTP (`Authorization: Bearer $CRON_SECRET`) for any external scheduler you prefer, except scraped shops: those run only in the cron service, because they take far longer than an HTTP request may.

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
- **Scaling**: `numReplicas` in `railway.json`, or Settings → Replicas. The app is stateless; sessions and radar state live in Postgres.

## What the repo config does

| File | Purpose |
|---|---|
| `railway.json` | Railpack build, `npm run db:migrate` before each deploy, `npm run start`, healthcheck on `/api/health`, restart on failure. |
| `src/app/api/health/route.ts` | 200 when the database answers within 5 s, else 503. |
| `src/services/ingestion/cli.ts` | Entry point for the cron service. |
| `package.json` `engines` | Pins Node 22 so Railpack picks the same runtime as CI. |
