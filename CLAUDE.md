# CLAUDE.md — Trilio

Read `docs/PRODUCT_SPEC.md` before building any feature. It records decisions the product owner already made; don't re-decide them silently. If something there seems wrong or missing, ask.

## Product in one paragraph
Trilio is a web app (mobile-first) that guides a shopper through a short one-question-per-screen flow for a chosen appliance type. It then returns up to three options from partner shops' live inventory, in three price tiers, plus a separate refurbished option. Users can track prices with a paid "Cenu radars" (€1/month). Launch market: Latvia, with Lithuania and Estonia later.

## Recommended stack (confirm with the owner before scaffolding)
- **Next.js (App Router) + TypeScript + Tailwind CSS.** SSR matters for SEO of category landing pages.
- **PostgreSQL** (Supabase or Neon) **+ Prisma or Drizzle.**
- **Auth:** Sign in with Google and email magic link (Auth.js). Sign in with Apple is deferred (owner decision, 18 Oct 2026).
- **Payments:** a PSP with hosted card fields plus Apple Pay and Google Pay (Stripe, or Montonio for the Baltics). Card data must never touch our servers.
- **Background jobs** for partner feed ingestion and price-history snapshots, plus a radar evaluator: cron or a queue worker.
- **Notifications:** transactional email (Resend or Postmark) and web push.
- **LLM (Claude API)**, used only where it adds value: parsing free-text requests into a subcategory and pre-filled answers, and drafting question sets for new categories (a human reviews them). Rankings and prices must be deterministic code, never LLM output.

## Non-negotiable product rules
1. **New and refurbished items are never mixed.** Refurbished offers appear in their own block. Each shows condition grade, warranty and the saving versus new.
2. **Budget is a hard filter.** Main picks are always within budget. If fewer than 3 fit, show at most 2 extras that cost no more than 25 % over budget, labelled "Virs budžeta par X €".
3. **Same product = same EAN.** Match offers across shops by EAN (GTIN). Fall back to brand plus normalised model code.
4. **Honest persuasion only.** No decoy products, fake scarcity, countdown timers, confirmshaming or hidden cancellation. Shop commission must never affect ranking, and the "Kā mēs izvēlamies un prioritizējam?" (how we choose and rank) panel says so.
5. **Discount claims use the lowest price of the previous 30 days** (EU Omnibus rule). Store price history from day one.
6. **Delivery dates count working days only** and respect LV/LT/EE public holidays. Prefer the shop's own ETA when its feed provides one.
7. **Shop names are configuration, not code.** The UI must not hard-code any retailer brand.

## UI and copy
- The UI language is **Latvian**, with Lithuanian and Estonian later. Keep all copy in i18n message files from the start.
- Latvian grammar matters. Use correct cases, a decimal comma (59,5 cm), a space before € (599 €) and a thin or normal space as the thousands separator (1 079 €).
- Follow `docs/BRAND.md`: dark "Nakts zaļš" background, lime accent, Space Grotesk headings and Figtree body text.
- **Accessibility:** use real `<button>`, `<a>` and `<label>` elements. Touch targets must be at least 44 px. Text contrast must be at least 4.5:1.
- Mobile first: the main flow must work at 360 px width.

## Conventions
- Business logic (filtering, scoring, tiers, deltas, energy cost) lives in pure, unit-tested TypeScript modules with no UI imports.
- Category questions are **data** (see `data/categories.json` and `docs/QUESTION_SCHEMA.md`), not hand-coded per page. Conditional questions use `showIf`; fridges and vacuums use the same schema as everything else.
- Money is integer cents in the database and formatted only at the edge.
- Never commit secrets. Use `.env.local` and keep `.env.example` up to date.
