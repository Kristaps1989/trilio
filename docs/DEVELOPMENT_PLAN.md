# Trilio — Development plan

Written after reviewing the handoff package (`CLAUDE.md`, `docs/*`, `data/*`, `reference/prototype-logic.js`, `design/prototype/*`). It turns the roadmap into concrete milestones, with the security, quality and mobile requirements each one has to meet. It does not re-decide anything `docs/PRODUCT_SPEC.md` already settles; where the handoff is silent or inconsistent, the point is listed under "Decisions needed" at the end.

---

## 1. Review of the handoff: what is solid, what needs attention

**Solid and usable as-is**
- `docs/PRODUCT_SPEC.md` is complete enough to build Phase 1 without guessing: flows, ranking rules, card content, copy.
- `data/categories.json` is valid: 8 groups + "Kaut kas cits", 33 subcategories, each generic one with 1–3 questions, `hard_filter` flags, `card_reason` and `table_value` strings, budget steps and compare-row labels. It can drive the UI directly.
- `data/sample-products.json` is valid: 253 products (239 new, 14 refurbished), 732 offers across 5 placeholder stores, every product has `ean`, `m` (model code), `s` (rating) and `kwh_year`.
- `reference/prototype-logic.js` parses and the ranking constants are explicit: score = rating × 10, +12 per matched soft answer, −40 when over budget, extras up to 1,25 × budget, electricity at 0,25 €/kWh, auto-advance after 260 ms.

**Needs attention before or during Phase 1**
1. **Fridge and vacuum flows are not in the schema.** Both have `custom_flow: true` and `questions: []`. The spec describes them in prose (section 2.2). They must be authored as data with `showIf` (niche height only if built-in; height-limit only if tall; freezer skipped if wide). This is a Phase 1 deliverable, not a later migration.
2. **Sample products have three different shapes.** Generic items use `sub`, `tags`, `specs`; fridges use `t, fz, nf, w, h, v, en, db`; vacuums use `t, run, mop, pet, db`. The seed script must normalise all of them into one `Product.attributes` JSONB shape, and the matching logic must read attributes, not shape-specific fields.
3. **Refurbished condition is on the product in the sample data but on the offer in `DATA_MODEL.md`.** The data model is right (one product per EAN, condition per offer, grade and warranty per offer). The seed script should merge refurbished sample entries (`c: "refurb"`, `g`, `wr`, `nw`) into offers against the new product with the same EAN. Where a refurbished sample has no new counterpart, create the product and flag it in the seed log so the data stays explainable.
4. **Offers have no delivery ETA, URL or last-seen timestamp in the sample.** The schema needs them from day one; the seed can fill ETA with a per-store default.
5. **The prototype's card form (spec 5.1 step 6) must not be built as our own inputs.** `CLAUDE.md` is explicit: card data never touches our servers. The production form is the PSP's hosted element styled to match; the Latvian validation messages come from the PSP's localisation plus our own copy around it.
6. **Store names in the sample are placeholders (`store_a`…`store_e`).** Keep it that way in code; display names come from the `Store` table (rule 7).
7. **Missing from the repo:** `.env.example`, licence, CI, lint/format config, `.gitignore`. All are Phase 0.
8. **`trilio-handoff.zip` duplicates everything now unpacked.** Delete it once the owner confirms.

---

## 2. Principles that shape every milestone

1. **Domain logic is pure TypeScript** in `src/domain/**` with no React, Next, Prisma or `fetch` imports. Every rule in spec section 3.1 is a function with unit tests. The UI only renders what the domain returns.
2. **Deterministic ranking.** The only LLM call in Phase 1 is free-text → subcategory id + pre-filled answers, and its output is validated against the category schema before use. It never touches scores or prices.
3. **Questions are data.** The page that renders a question does not know which category it is in. Adding a subcategory means editing JSON, not code.
4. **Money is integer cents** in the database and in the domain layer; `formatEur()` runs at the edge.
5. **Price history from the first ingestion run.** `PriceSnapshot` rows are written in Phase 1 even though nothing reads them until Phase 2, so the 30-day low is real at radar launch.
6. **Mobile first means 360 px first.** Every screen is built and reviewed at 360 px before any wider breakpoint.
7. **Nothing a user can affect reaches the server unvalidated.** Zod schemas at every boundary: route handlers, server actions, feed parsers, LLM responses, PSP webhooks.

---

## 3. Stack and architecture (needs the owner's confirmation, see §9)

| Concern | Choice | Why |
|---|---|---|
| Framework | Next.js 15 App Router, TypeScript strict, React Server Components | SSR for category landing pages (Phase 3 SEO), server actions for form submissions, one deployable |
| Styling | Tailwind CSS v4 with brand tokens from `docs/BRAND.md` as CSS variables | Fast to build, easy to enforce tokens |
| Fonts | `next/font/google` for Space Grotesk and Figtree, `display: swap`, Latin Extended subset | Self-hosted at build time, no layout shift, covers LV/LT/EE diacritics |
| Database | PostgreSQL (Neon or Supabase) + Drizzle ORM | Typed queries, SQL migrations in git, JSONB for attributes and answers |
| i18n | `next-intl` with `messages/lv.json` | Server-side message loading, ICU plural rules for Latvian (which has three plural forms) |
| Validation | Zod | Shared schemas between client, server and tests |
| Auth (Phase 2) | Auth.js v5: Apple, Google, email magic link via Resend | Matches spec 5.1 step 4 |
| Payments (Phase 2) | Stripe Checkout + Billing (Apple Pay, Google Pay, card, SEPA later), or Montonio | Hosted fields, Baltic wallet support; decide with owner |
| Jobs | Vercel Cron or a small worker (Node + `node-cron`) hitting signed internal routes; move to a queue if ingestion grows | Simple start, clear upgrade path |
| Email / push | Resend; Web Push via `web-push` (VAPID) | Phase 2 |
| LLM | Claude API via `@anthropic-ai/sdk`, server-side only, structured output validated with Zod | Free-text routing only |
| Observability | Sentry (errors), structured JSON logs, Vercel Analytics or Plausible (cookieless) | No consent banner needed in Phase 1 if no tracking cookies |
| Hosting | Vercel (EU region `fra1`) + EU-hosted Postgres | GDPR, roadmap open question 6 |
| Testing | Vitest (domain + utils), Playwright (flows at 360 px and 1280 px), `@axe-core/playwright` (a11y) | |
| CI | GitHub Actions: typecheck, lint, unit, e2e, build, `npm audit --audit-level=high` | Every PR, required to merge |

### Repository layout

```
src/
  app/                      # routes, layouts, server actions only — no business logic
    (flow)/                 # welcome, category, question, results
    (model)/                # "Es jau zinu modeli"
    (radar)/                # Phase 2
    api/                    # route handlers: affiliate redirect, webhooks, cron
  domain/                   # pure TS, unit-tested, no UI/DB imports
    catalog/                # product + offer types, EAN normalisation, model-code normalisation
    questions/              # schema types, showIf evaluation, progress counting
    ranking/                # filter, score, pickThree, tiers, extras, recommendation
    delta/                  # upgrade delta text, energy cost, TCO
    compare/                # compare rows, best-value highlighting, "differences only"
    delivery/               # working days, LV/LT/EE holidays, ETA
    pricing/                # 30-day low, discount claims (Omnibus)
    radar/                  # Phase 2 evaluator rules
  db/                       # drizzle schema, migrations, seed
  services/                 # ingestion adapters, EPREL client, LLM router, email, PSP
  i18n/                     # messages/lv.json, formatters (decimal comma, thin-space thousands, "599 €")
  ui/                       # components: OptionRow, PrimaryButton, ResultCard, CompareGrid, ProgressBar…
data/                       # categories.json, sample-products.json (seed input)
docs/
tests/e2e/
```

---

## 4. Phase 0 — Foundation (week 1)

Goal: a repo where every later PR is automatically checked for type errors, lint, tests, accessibility and known-vulnerable dependencies.

**Tasks**
- Scaffold Next.js + TypeScript (strict, `noUncheckedIndexedAccess`) + Tailwind + ESLint (`next/core-web-vitals`, `jsx-a11y`, `@typescript-eslint` strict) + Prettier.
- `.gitignore`, `.env.example` (every variable with a comment, no values), `README.md` dev section.
- Brand tokens: CSS variables for the colour table, Tailwind theme extension, font setup, base typography (16–18 px body, 1.5 line-height).
- `src/i18n/messages/lv.json` seeded with all strings from the spec. No string literal in JSX from this point on; an ESLint rule (`i18next/no-literal-string` or a custom one) enforces it.
- Formatters with tests: `formatEur(cents)` → `1 079 €`, `formatNumber(59.5)` → `59,5`, `formatDate` → `trešdiena, 21. oktobris`.
- Drizzle schema for `Store`, `Category`, `Product`, `Offer`, `PriceSnapshot`, `SearchSession`, `WaitlistLead`, `AffiliateClick` (Phase 1 tables), with the first migration.
- Seed script: normalises `data/sample-products.json` into the schema (see §1 item 2–3), loads `data/categories.json` into `Category`.
- Security headers in `next.config.ts`: CSP (nonce-based, no `unsafe-inline` for scripts), HSTS, `X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`. Verified by a Playwright test.
- GitHub Actions workflow: typecheck, lint, unit, build, e2e (Chromium, 360 px and 1280 px viewports), `npm audit`, Dependabot or Renovate enabled.
- Sentry with PII scrubbing; structured logger.

**Done when:** `main` is protected, CI is green on an empty app showing the welcome screen in Latvian with the brand fonts, at 360 px, with no axe violations.

---

## 5. Phase 1 — MVP: guided choice and affiliate links (weeks 2–7)

### Milestone 1.1 — Question schema and engine (week 2)

- Define the schema type in `src/domain/questions/schema.ts`: question `id`, `type` (`single | multi | number | text`), `title`, `why`, `hard_filter`, `options[]`, `max_select`, `showIf` (JSON condition on earlier answers), `help` for "I don't know", `default`.
- Author `fridge` and `vacuum` questions in `data/categories.json` using that schema (spec 2.2). Add `budget` and `urgency` as shared question definitions appended to every subcategory, `refurbished` appended only when refurbished stock exists for that subcategory (computed at query time, not in JSON).
- Engine functions, all pure and tested: `visibleQuestions(schema, answers)`, `progress(schema, answers)` → "N no M" where M counts only currently visible questions, `nextQuestion`, `validateAnswer`.
- JSON Schema + Zod validation of `categories.json` in a unit test so a bad edit fails CI.

### Milestone 1.2 — Guided flow UI (weeks 2–3)

- Routes: `/` welcome, `/izvelies` group tiles, `/izvelies/[group]` subcategories, `/izvelies/[group]/[sub]/[step]` one question per screen.
- Answers live in the URL (`?a=` base64url-encoded JSON, validated) so refresh, back button and sharing all work; the Typeform-style back button is `router.back()`. No `sessionStorage` dependence.
- Components built to brand spec: `OptionRow` (min-height 60 px, letter badge, lime selected state), `PrimaryButton` (min-height 52–56 px), `ProgressBar`, `WhyNote`, `IDontKnow` reveal.
- Auto-advance after 260 ms for single choice; "Turpināt" for multi/number/text; `prefers-reduced-motion` disables the flash animation.
- Group tiles: `other` tile spans full width.
- Free text ("Kaut kas cits"): first try `free_text_detection` regexes locally; if no match, call the server action that uses Claude with a structured schema `{ subcategory: enum | null, prefilled: Record<string,string>, outOfScope: boolean }`. Validate against the category schema; discard any pre-filled answer whose value isn't a valid option. Out-of-scope → waitlist screen, save `WaitlistLead`. Rate-limit the action per IP (e.g. 10/min) and cap input at 300 characters.

### Milestone 1.3 — Ranking domain (week 3–4)

All in `src/domain/ranking`, pure, with table-driven tests. Inputs are plain product/offer objects; the DB layer maps rows to them.

- `eligibleOffers(product, urgency)`: in stock, or in stock + soon for "two weeks" and "no rush"; **never refurbished** in the main pool.
- `passesHardFilters(product, schema, answers)`.
- `score(product, schema, answers)`: rating × 10, +12 per matched soft answer; bespoke priority weights for fridge/vacuum; −40 if over budget.
- `pickThree(candidates)`: best score, cheapest of the rest, best remaining by score or first priority.
- `assignTiers(picks)`: sort by price → `budget | mid | top`; `recommended` = highest score.
- `extras(pool, budget)`: when fewer than 3 in budget, at most 2 at ≤ 1,25 × budget, each with `overBudgetByCents`.
- `refurbishedBlock(products, answers)`: separate list, same filters, with `savingVsNewCents`.
- Tests that must exist (CLAUDE.md asks for these explicitly): budget is a hard filter; extras never exceed 25 %; extras only appear when fewer than 3 fit; new and refurbished never share an array; `recommended` is the top score regardless of tier; empty-result path.

### Milestone 1.4 — Delta, energy, delivery, 30-day low (week 4)

- `energyCost10y(kwhYear, pricePerKwhCents)` (default 25 ct, configurable via `Settings`); `tco`.
- `upgradeDelta(cheaper, pricier, categoryRules)` → list of positive and negative differences with Latvian templates ("+48 L tilpums", "par 4 dB klusāks", "~60 € vairāk par elektrību 10 gados"), or the "atšķirība galvenokārt zīmolā un dizainā" fallback.
- `whyItFits(product, answers)` → up to 3 `card_reason` strings.
- `addWorkingDays(date, n, country)` with an LV/LT/EE holiday table (static JSON per year, including movable holidays; a test pins known dates such as 2026-06-23/24 and Easter Monday). Prefer the shop's ETA when the feed has one.
- `lowest30d(snapshots)` and `discountClaim(current, lowest30d)` so every "cheaper than" or "−X %" string is Omnibus-safe.

### Milestone 1.5 — Results, compare, refurbished (weeks 5–6)

- `/rezultati` server-rendered from the URL answers: title, lead text, answer chips, EAN note, "Kā mēs izvēlamies un ranžējam?" `<details>` panel with the commission disclosure and energy price assumption.
- `ResultCard` per spec 3.2, with the over-budget variant (dashed orange border, pill) and the refurbished variant (blue scheme, separate block, "RĀDĪTA ATSEVIŠĶI").
- Compare grid: `<table>` with `<th scope>`, sticky first column, horizontal scroll inside a container at narrow widths, best-value shading only when values differ, "Rādīt tikai atšķirības" toggle.
- "Mainīt atbildes" returns to the first question with answers intact; "Sākt no jauna" clears the URL state.
- "Sekot cenai" in Phase 1 opens a modal explaining the radar is coming and collects an email into the waitlist (no payment yet).

### Milestone 1.6 — Model-check flow (week 6)

- `/modelis`: input accepts model name, model code or a shop URL. URL parsing is a strict allow-list of partner domains; anything else is treated as plain text.
- Lookup by normalised model code, then by name similarity (Postgres `pg_trgm`).
- Alternatives: same size class, price within ±12 %, ranked by TCO.

### Milestone 1.7 — Data: ingestion, affiliate clicks (week 7)

- `src/services/ingestion/`: an adapter interface (`fetch → parse → normalise → upsert`), the sample-data adapter, and **one** real partner adapter. Feed URLs come only from the `Store` table; the fetcher refuses non-HTTPS, private IP ranges and redirects off the configured host (SSRF guard). XML parsed with `fast-xml-parser` with entity expansion disabled (XXE guard). Size cap on feed bodies.
- EAN: validate the GTIN check digit, pad to 13 or 14; fallback key = `brand + normalisedModelCode` (strip spaces, hyphens, slashes, case).
- Each run writes `PriceSnapshot` for every offer and marks offers not seen as `out` after a grace period.
- Cron route `/api/cron/ingest` protected by a bearer secret compared with `timingSafeEqual`.
- Affiliate link: `/go/[offerId]` route handler that records `AffiliateClick`, then 302s to the store's `affiliate_template_url` with the offer URL inserted. The target is built server-side from the DB only, never from the request, so it cannot be an open redirect. `rel="sponsored noopener"` on the link.
- EPREL client for `kwh_year` and `energy_class` keyed by model identifier, cached in the DB, run as part of ingestion.

**Phase 1 done when:** a user at 360 px can go from welcome to three ranked results with affiliate links for every subcategory, all Phase 1 domain modules have ≥ 90 % branch coverage, Playwright runs the fridge, vacuum, one generic and the free-text flows, Lighthouse mobile scores ≥ 90 for performance and 100 for accessibility on the results page, and one real partner feed is ingesting on a schedule with snapshots accumulating.

---

## 6. Phase 2 — Price radar (weeks 8–13)

### 2.1 Auth (week 8)
- Auth.js v5 with Apple, Google, email magic link (Resend). Database sessions, `httpOnly` `Secure` `SameSite=Lax` cookies, 30-day expiry, rotation on sign-in.
- Magic links: single-use, 15-minute expiry, token stored hashed, generic response whether or not the email exists, rate-limited per email and IP.
- Account page: data export (JSON of `User`, `SearchSession`, `Radar`, `RadarEvent`) and deletion (hard delete plus PSP customer cancellation), as GDPR requires.
- `proxy.ts`/middleware gates `/radars/**`.

### 2.2 Subscription (weeks 9–10)
- PSP hosted checkout for the €1/month plan (or the annual plan if the owner chooses it, see §9). Apple Pay / Google Pay via the PSP's Payment Request button.
- Webhook handler: verify signature, idempotency by event id, update `Subscription` state. The app reads entitlement from our DB, never live from the PSP on page load.
- Customer portal (PSP-hosted) for changing the payment method and cancelling; our "Atteikties no abonementa" confirms, then calls the PSP API; "Atjaunot abonementu" reverses it. Cancellation must be at most two taps from the radar page (no dark patterns).

### 2.3 Radar setup and page (weeks 10–11)
- Three setup questions reuse the question engine and `OptionRow`.
- `Radar` CRUD via server actions with Zod; ownership checked on every mutation (`where user_id = session.user.id`).
- Radar page per spec 5.2: pause/resume, sparkline from 30 snapshots (inline SVG, no chart library), filters panel with summary line, undo toast for removal (soft-delete with a 10-second window), channels.
- Signed-out state shows only the sign-in buttons.

### 2.4 Evaluator and notifications (weeks 12–13)
- `src/domain/radar/evaluate.ts`: pure function from (radar, offers, snapshots, comparable products) → events. Tests for each threshold, store filter, scope, refurbished inclusion, and the one-per-product-per-day debounce.
- Job runs after each ingestion. Email via Resend templates in Latvian; Web Push with VAPID keys, subscription stored per user and device, unsubscribe on 410.
- Every notification links to the radar page and includes a one-click unsubscribe.

**Phase 2 done when:** a signed-in, subscribed user receives an email and a push within one ingestion cycle of a qualifying price drop in a test store, can cancel in two taps, and a deleted account leaves no rows and no PSP subscription.

---

## 7. Phase 3 — Scale (after launch)

- Real data for all 33 subcategories; LLM-drafted question sets go through a `draft/` folder and a human PR review before entering `categories.json`.
- More partner adapters; adapter conformance test suite (fixture feed → expected normalised rows).
- `lt` and `et` locales: message files, holiday tables, store country filter, number formatting rules per locale.
- SEO landing pages `/[locale]/[category]/lidz-[budget]` with static generation + ISR, structured data (`Product`, `AggregateOffer`), canonical URLs.
- Move ingestion to a queue if runtime exceeds the cron limit.

---

## 8. Cross-cutting requirements

### 8.1 Security checklist (reviewed at every milestone)
- [ ] No secrets in git; `.env.example` complete; server-only env never imported into client components (`server-only` package).
- [ ] CSP with nonces, no inline scripts, `frame-ancestors 'none'`.
- [ ] All inputs validated with Zod: server actions, route handlers, URL answer state, feed rows, LLM output, PSP webhooks.
- [ ] Rate limiting on free-text routing, magic-link requests, waitlist, affiliate redirects (per IP, in-memory for Phase 1, Upstash/Redis later).
- [ ] Affiliate redirect builds targets from DB only; no user-supplied URL is ever redirected to.
- [ ] Feed fetcher: HTTPS only, host allow-list from DB, no private IPs, body size cap, XML with entity expansion off.
- [ ] LLM: prompt treats user text as data; output schema is an enum of known subcategory ids; max input length; cost cap per day; prompt and output logged without PII.
- [ ] Auth: database sessions, `httpOnly` cookies, CSRF handled by Auth.js, magic-link tokens hashed and single-use.
- [ ] Payments: PSP hosted fields only; webhook signatures verified; idempotent handlers; entitlement from our DB.
- [ ] Every DB mutation on user-owned rows filters by the session user id.
- [ ] Dependencies: Dependabot/Renovate, `npm audit --audit-level=high` in CI, lockfile committed.
- [ ] Sentry scrubs emails and tokens; logs never contain answers linked to identities beyond what GDPR consent covers.
- [ ] Images via `next/image` with `remotePatterns` limited to partner CDNs.

### 8.2 Mobile and accessibility checklist (reviewed at every milestone)
- [ ] Built and visually checked at 360 px first; Playwright runs every flow at 360 × 740 and 1280 × 800.
- [ ] Touch targets ≥ 44 × 44 px; option rows ≥ 60 px; primary buttons ≥ 52 px.
- [ ] Real `<button>`, `<a>`, `<label>`, `<fieldset>/<legend>` for question groups, `<table>` for compare; visible focus rings; keyboard-only run of every flow.
- [ ] Contrast ≥ 4.5:1 for all text; `stone` on `night-green` and `muted-on-white` on white verified with a test.
- [ ] Inputs use `font-size ≥ 16px` (prevents iOS zoom), `inputmode="numeric"` for niche height, `enterkeyhint`.
- [ ] Use `100dvh`, not `100vh`; respect `env(safe-area-inset-*)` on sticky footer and back button.
- [ ] No horizontal page scroll; compare grid scrolls inside its container with a visible edge hint.
- [ ] `prefers-reduced-motion` respected (auto-advance still works, animation off).
- [ ] Screen-reader announcements: progress "Jautājums N no M" in `aria-live="polite"`, results heading focused on arrival.
- [ ] Works with JavaScript disabled for the read-only paths (welcome, category lists, results from URL) thanks to server rendering; interactive parts degrade to full-page form posts via server actions where feasible.
- [ ] Lighthouse mobile: Performance ≥ 90, Accessibility 100, Best Practices 100; LCP < 2,5 s on simulated 4G for the results page.
- [ ] axe has zero violations in CI.

### 8.3 Performance
- Results page is a server component; the domain ranking runs on the server over a pre-filtered DB query (subcategory + in-stock + price ≤ 1,25 × budget), so client JS stays minimal.
- Fonts self-hosted via `next/font`; images lazy-loaded with explicit dimensions.
- Static category pages cached; results cached per answer-hash for 5 minutes (prices change at most a few times a day).
- Bundle budget enforced in CI: first-load JS on the flow routes ≤ 120 kB gzipped.

### 8.4 Testing strategy
| Layer | Tool | What it covers |
|---|---|---|
| Domain | Vitest, table-driven | Every rule in spec 3.1–3.4, delta text, working days, Omnibus, evaluator |
| Schema | Vitest + Zod | `categories.json` validity, every subcategory has budget steps and compare labels |
| Formatting | Vitest | Decimal comma, thousands space, "€" spacing, dates in Latvian |
| Ingestion | Vitest with fixture feeds | Normalisation, EAN validation, out-of-stock grace, snapshot writes |
| UI flows | Playwright at 360 px and 1280 px | Fridge, vacuum, one generic, free text, model check, radar setup |
| Accessibility | axe in Playwright | Every route |
| Security | Playwright + unit | Headers present, redirect allow-list, webhook signature rejection, rate limit |
| Contrast | Unit test on tokens | All text/background pairs ≥ 4.5:1 |

### 8.5 Data and operations
- Migrations in git, applied in CI against a throwaway Postgres before deploy.
- Ingestion schedule: every 4 hours initially; configurable per store.
- Backups: provider's daily snapshots plus a weekly logical dump to EU object storage.
- Runbook in `docs/RUNBOOK.md`: how to add a store, rotate secrets, replay a webhook, re-run ingestion for one store.
- Feature flags via environment (`FEATURE_RADAR`, `FEATURE_FREE_TEXT_LLM`) so Phase 2 code can ship dark.

---

## 9. Decisions needed from the owner before starting

1. **Stack**: ✅ confirmed (Next.js + Tailwind + Drizzle + Neon/Supabase + Vercel EU, as in §3).
2. **PSP**: ✅ **Paysera Recurring Billing** (owner decision after the Stripe proposal; see `docs/PAYMENTS.md`). Stripe can be added as a second provider behind the same interface. **Pricing (proposed, awaiting confirmation):** 12 €/year as the anchor and 1,99 €/month. The owner's first suggestion of 5 €/month + 12 €/year was rejected because the monthly plan would be an 80 % markup over annual, which acts as a decoy (rule 4). Net after 21 % VAT and Stripe fees: ≈ 9,41 €/year or ≈ 1,34 €/month. Stripe Checkout + Billing with Apple Pay, Google Pay and card; Stripe Tax for VAT.
3. **Partner shops**: ✅ neoshop.lv, m79.lv, rdveikals.lv, euronics.lv, 1a.lv, discover.lv as `Store` rows. Still needed per shop: affiliate link format and feed URL/format. The first adapter is built for whichever shop provides feed access first.
4. **"Trilio vērtējums" inputs**: the sample uses a single `s` number. Which real inputs produce it (EPREL class, warranty, review score, return rate)? The ranking panel must be able to explain it.
5. **Electricity price**: fixed 0,25 €/kWh in settings, or fetched periodically.
6. **Delete `trilio-handoff.zip`** from the repo now that it is unpacked.
7. **Licence** for the repository (private/proprietary is fine, but say so in `LICENSE`).
8. **Domain names and trademark** check (roadmap open question 4) before any public URL appears in email templates.

Once 1–3 are answered, Phase 0 can start immediately; 4–8 can be settled during Phase 0.
