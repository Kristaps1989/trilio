# Roadmap (suggested)

## Phase 1 — MVP: guided choice and affiliate links
- Scaffold: Next.js, TypeScript, Tailwind, Postgres and i18n (LV).
- Category and question schema from `data/categories.json`. Migrate the fridge and vacuum flows into the schema with `showIf`.
- Seed with `data/sample-products.json`. Then connect **one** real partner feed and its EAN normalisation.
- Results page: picks, tiers, recommendation, upgrade delta, energy over 10 years (EPREL), compare table, refurbished block, ranking explanation.
- Affiliate click tracking.
- Free-text routing (Claude API) and the waitlist.
- Unit tests for filtering, scoring, tiers and delta. They must cover the budget rule and never mixing new with refurbished.

## Phase 2 — Price radar
- Price snapshots from the start of Phase 1, so the 30-day low is available at launch.
- Auth: Apple, Google and email magic link.
- PSP subscription with Apple Pay, Google Pay and card.
- Radar CRUD with filters, plus the evaluator job, email and push.
- Radar page: pause/resume, remove with undo, change payment method, cancel.

## Phase 3 — Scale
- All 30+ subcategories with real data. Draft question sets for new categories with the LLM, then review them by hand.
- More partner shops, then LT/EE locales and shops.
- SEO landing pages per category, for example "Labākie ledusskapji līdz 800 €" (best fridges under €800).

## Open questions for the owner
1. **Partners:** which shops, which feed formats and which affiliate network or terms?
2. **Pricing:** card fees take a large share of a €1 charge. Consider an annual plan (e.g. 9–10 €/year) or charging only once the user tracks something.
3. **"Trilio vērtējums" (Trilio rating) method:** which inputs count (specs, warranty, return rates, reviews)? It must be explainable on the ranking panel.
4. **Domains and trademark:** register trilio.lv and trilio.eu, and check the trademark against Trilio (trilio.io, a US backup-software company).
5. **Electricity price:** a fixed 0,25 €/kWh, or regional and periodically updated?
6. **Hosting and region:** run in the EU for GDPR.
