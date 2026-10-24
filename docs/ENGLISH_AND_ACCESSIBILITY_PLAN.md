# English language support, and a content accessibility review

Owner, 24 Oct 2026: prepare a plan for English on the platform, and review content accessibility.

Part A is the plan for English. Part B is the accessibility review: what is good, what to fix, and what English changes about it.

## Part A — English

### 1. What English is for

Latvia's English readers are mostly expats, foreign students and workers, and tourists buying an appliance for a rented flat. They buy in the same Latvian shops, pay in euros, and get the same delivery. So English is a **second language of the same market**, not a new market: same shops, same holidays, same prices, same `MARKET=LV` deployment. Lithuania and Estonia stay separate deployments as planned (`docs/LOCALES.md`).

Two consequences:

- The language is **chosen per request** (by the URL), not per deployment as today.
- Everything a shopper reads must exist in English, but nothing that is Latvian by law or by nature changes: the Latvian legal texts remain the binding ones, product names stay as the shops write them, and the admin stays Latvian.

### 2. What is Latvian-only today

The code was built for several languages: every UI string lives in `src/i18n/messages/lv.json`, and `lt.json`/`et.json` are already scaffolded with fallback to Latvian. English fits into this. The rest of the Latvian content is in five places:

| Where | What | Size | Plan |
|---|---|---|---|
| `src/i18n/messages/lv.json` | Every UI string, e-mails, legal pages | 1 314 strings, ~6 600 words | Translate into `en.json`. |
| `data/categories.json` | Category and question texts: `label`, `sublabel`, `title`, `help`, `why`, `card_reason`, `table_value`, `description` | ~600 strings, ~4 400 words | Add an `en` variant per text field (see §4.2). |
| `data/attributes.json` | Attribute labels and units shown in compare tables and deltas | 27 label strings; the rest are matching patterns that stay Latvian | Add `en` labels. |
| `data/brands.json` | Reliability notes shown under "Vērts apsvērt" | notes per brand | Add `en` notes; or show the grade without the note in English until translated. |
| `src/i18n/format.ts` | Latvian weekday and month names in three cases, decimal comma, "599 €", `categoryGender` | one file | Branch on the request locale (§4.3). |

Hard-coded Latvian outside these files is small and listed in §4.4: page `<title>`s in the admin and order pages, `llms.txt`, the Open Graph alt text, the global error page, the invoice line "Piegāde Latvijā", two payment descriptions, and the e-mail helpers that read `lv.json` directly for background jobs.

What stays Latvian on purpose:

- **Product names** come from the shops ("Bosch ledusskapis KGN39…"). Trilio adds the type word when the shop's name lacks it (`naming.ts`); in English that word comes from the English category label. The shop's own words stay as they are, marked `lang="lv"` so screen readers pronounce them right.
- **Legal texts.** Consumer information in Latvia must be available in Latvian. The English pages are a convenience translation with a line saying the Latvian version prevails.
- **Admin section.** One reader, Latvian.
- **Attribute matching patterns**, the accessory filter and the LLM extraction prompt read Latvian shop data; they are not UI.

### 3. Decisions (recommended; confirm)

1. **URL:** Latvian stays at the root (`trilio.lv/izvelies`), English under `/en` (`trilio.lv/en/izvelies`). Path segments stay Latvian in both; English slugs would need a second set of routes and give little, because English search demand in Latvia is small. `hreflang` links each pair.
2. **No automatic redirect by browser language.** Search engines, shared links and the smoke tests all expect one stable page at one URL. Instead: a language switch in the header, and a cookie that remembers the choice for the next visit to the root.
3. **Numbers in English:** `€599`, `€1,079`, `59.5 cm` (English conventions) rather than the Latvian `599 €` and `59,5 cm`. Dates: "Wednesday, 28 October". Energy and sizes keep the EU units.
4. **E-mails** follow the account's language (`users.locale`, which exists but is never set): set when the account is created from an English page, changeable on the account page. The admin's own notes and offer e-mails are typed by the admin in whichever language they choose; the surrounding template follows the recipient's language.
5. **Russian** is not in this plan. If it comes later, it fits the same mechanism; the free-text routing already accepts Russian.

### 4. Changes

#### 4.1 Routing and locale per request

- `next-intl` routing with `locales: ["lv", "en"]`, `defaultLocale: "lv"`, `localePrefix: "as-needed"`: the Latvian URLs do not change. The current `src/proxy.ts` (CSP nonce) is composed with next-intl's middleware in one `proxy` function.
- `src/app/[locale]/` wraps the public pages; the admin, API routes and `/go` stay outside it. `currentMarket()` keeps deciding stores and holidays; the locale comes from the request.
- `<html lang>` follows the locale; the Open Graph `locale` becomes `en_GB` on English pages.
- Every internal link goes through next-intl's `Link`, so `/en` is kept while browsing.
- The language switch: a small "EN / LV" control in the header, on every public page, linking to the same page in the other language.

#### 4.2 Category and attribute texts

`data/categories.json` is the shopper's main reading matter (questions, options, help). Two ways to translate it:

- (a) a parallel `categories.en.json` with the same ids and only text fields; or
- (b) text fields become objects `{ "lv": "…", "en": "…" }` in the one file.

**Recommended: (a).** The Latvian file stays readable and diffable, the schema validator (`src/domain/questions/schema.ts`) checks that every id in the English file exists and every text field is covered, and a missing English text falls back to Latvian exactly like `lv.json` does. `getSubcategory(id, locale)` returns the merged view; the flow, results, landing pages and compare table already read labels through it. The same for `attributes.json` labels and `brands.json` notes.

#### 4.3 Formatting

`src/i18n/format.ts` gets a locale parameter (defaulting to the request locale):

- prices and numbers through `Intl.NumberFormat` (`lv-LV` keeps today's output with the thin space; `en` gives `€1,079`);
- dates through `Intl.DateTimeFormat` for English; the Latvian case tables stay for `lv`;
- `categoryGender` only applies to Latvian; the English title patterns do not need gender (`landing.title` uses an ICU `select` today, which simply has one branch in `en.json`).

Unit tests cover both languages.

#### 4.4 The small hard-coded leftovers

- Page `<title>`s set as literals (`"Rēķins"`, `"Pasūtījums"`, `"Vai viss kārtībā?"`, `"Atteikties no piedāvājumiem"`, the admin ones) move to messages; the admin's may stay Latvian.
- `llms.txt`, the Open Graph alt text, `global-error.tsx` (it has no access to messages; it gets a small English fallback beside the Latvian).
- Invoice line "Piegāde Latvijā" and payment descriptions: from messages, in the buyer's language.
- `src/services/texts.ts` and `src/services/offers/texts.ts` read `lv.json` directly for background jobs. They take the recipient's `users.locale` and load that file.
- `src/domain/analytics/page.ts` section mapping gets the `en` prefix stripped before matching, so statistics count `/en/rezultati` as "results".

#### 4.5 SEO for the English pages

- `alternates.languages` (`lv`, `en`, `x-default` → lv) on every indexable page; the sitemap lists both URLs with alternates.
- English landing pages (`/en/kategorija/...`) get English titles and descriptions and the same JSON-LD; `inLanguage: "en"`.
- `robots` is unchanged; `/en/admin` does not exist.

#### 4.6 Translation itself

- `en.json`: about 6 600 words. Written by a person who knows Trilio's voice (the guidelines in `docs/BRAND.md` and the plan documents apply: plain words, no marketing filler, numbers with units). AI can draft; a person reviews every string, and the legal pages are reviewed by whoever reviews the Latvian ones.
- `categories.en.json`: about 4 400 words of questions and options. These are the words a shopper decides by, so they get the same review as the UI.
- Brand notes and attribute labels: small.
- A check in CI: every key in `lv.json` and every text field in `categories.json` has an English counterpart, or the build logs the missing ones (a partial translation still ships, falling back to Latvian).

#### 4.7 Tests

- Unit: formatters in both locales; the merged category view falls back correctly; the message-key check.
- E2E (mobile-360 and desktop): the full guided flow in English for one category; the language switch keeps the page; `hreflang` pairs on the home, a group page, a landing page; an English results page has `lang="en"` and the product names carry `lang="lv"`; the English checkout and order page; an English account gets English e-mails (through the memory sender in unit tests).

### 5. Order of work

1. **Routing and switch** (no translation yet): `/en` serves the Latvian texts, `lang` and `hreflang` are right, nothing else changes. This is the risky part and is done alone.
2. **Formatters and the leftovers** (§4.3, §4.4), with tests.
3. **Category data in English** (§4.2) and the loader.
4. **`en.json`** translation and review; English e-mails; the message-key check in CI.
5. **SEO** (§4.5) and the e2e run in English.

Steps 1–3 and 5 are code; step 4 is mostly writing. Each is one PR.

## Part B — Content accessibility review

Checked: the automated WCAG 2.1 A/AA rules (axe) already run on every main page in the e2e suite and pass; the design tokens; the markup of the question flow, results, cards, forms, tables and charts; and the texts themselves.

### 6. What is already right

- **Contrast.** Every text/background pair in the design system clears AA with room: stone on night 7.7:1, muted on white 6.7:1, muted on the lime "upgrade" box 6.1:1, the amber over-budget pill 7.1:1, lime on night 12.2:1.
- **Real controls.** Buttons, links and labels are real elements; the question options are `role="radio"` buttons inside a labelled `radiogroup`; the range slider has `aria-valuetext`; the price histogram and the price-history chart are `role="img"` with a spoken summary. Touch targets are 44 px or more everywhere (`min-h-11` and up).
- **Focus and motion.** A visible lime focus ring on every element, `prefers-reduced-motion` honoured in CSS and in the flow's transitions.
- **Forms.** Errors are tied to fields with `aria-describedby`, marked `aria-invalid`, and announced with `role="alert"`; live counts in the flow use `aria-live="polite"`.
- **Language.** `<html lang>` follows the locale. Pinch-zoom is not disabled.
- **Tables.** The compare table uses `<th scope>`; the admin tables have captions and are keyboard-scrollable.
- **Plain copy.** One question per screen, "Kāpēc jautājam" explanations, "Nezinu" options, concrete dates instead of "this week", prices with units.

### 7. What to fix

| # | Finding | Why it matters | Fix | Size |
|---|---|---|---|---|
| 1 | **No skip link.** `<main id="saturs">` exists, but there is no "Pāriet uz saturu" link before the header. | Keyboard and screen-reader users tab through the header on every page (WCAG 2.4.1). | A visually hidden link that appears on focus, first in `<body>`. | Small |
| 2 | **Radio options do not move with arrow keys.** The options are focusable buttons with `role="radio"`, so Tab goes through every option and arrows do nothing. | The radiogroup pattern promises arrow-key movement; screen readers announce "1 of 5" and expect it. | Roving `tabIndex` and an `onKeyDown` handler for arrows in `QuestionScreen`, or native `<input type="radio">` visually styled. | Small |
| 3 | **Product names are Latvian on English pages** (and shop names are sometimes English or Russian on Latvian pages). | Screen readers pronounce text in the page language; a Latvian name read with English rules is hard to follow (WCAG 3.1.2). | `lang="lv"` on the product name element in every card; keep for English. | Small |
| 4 | **Illustrations are `aria-hidden`, which is right, but the option tiles then rely on text only** — good; however the **energy class** arrow is read as "Energoklase E" and its link texts are "Energomarķējums" / "Informācijas lapa" without saying they open EPREL (an external site) or a PDF. | Link purpose (2.4.4) and warning before a format change. | Append the visually hidden "(EPREL, atver jaunā cilnē)" / "(PDF)" to the link text. | Small |
| 5 | **The results page's three cards are a flex row; on desktop the recommended card is highlighted by a lime ring only** (plus the "Trilio ieteikums" pill, which is good). The over-budget card uses a dashed border plus a pill, also good. The **"Bet:" trade-off line is muted grey**, which is text-only, fine; but the **price-history chart's low/high are colour-coded dots** without text in the chart. | Information conveyed by colour alone (1.4.1) is avoided already in most places; check the chart. | The chart's `aria-label` already states low and high; add the two values as visible text under it. | Small |
| 6 | **Small text.** 13 px is used for pills, meta lines and the footer tagline (18 places); 11 px in the admin chart axis. | Fine for AA (no minimum size), but 13 px light grey on dark is tiring for older readers, who are a large share of appliance buyers. | Raise meta lines to 14 px where they carry information (price history, delivery line); keep 13 px for pills. | Small |
| 7 | **The global error page** has `lang="lv"` hard-coded and no English. | Rare, but when it shows, it shows to everyone. | Bilingual text on that page (it cannot load messages). | Small |
| 8 | **Headings in the results page.** The page has an `h1`, cards use `h3`, and the sections ("Ieteiktie varianti", "Atjaunota prece") are regions with labels but not all have a visible `h2`. | Heading navigation (screen-reader users jump by heading) works best with a complete outline. | Make each region's label a visible or visually hidden `h2`. | Small |
| 9 | **Automated tests run on the main pages, not on every page.** New pages (offer, checkout, order, invoice, admin) were covered in their own specs; the account, sign-in and payment plan pages are not all axe-checked. | Regressions slip in where no test looks. | One e2e that visits every public route and runs axe, so a new page is covered by default. | Small |
| 10 | **Readability of long legal pages.** The privacy and terms pages are long paragraphs with correct headings; no summary. | Most readers want the three things that matter to them. | A short "Īsumā" list at the top of each legal page (what we collect, how to delete, how to complain), kept in sync with the full text. | Content |

None of these is a WCAG failure caught by axe; items 1, 2, 3 and 8 are the ones that change how the site works with a keyboard or a screen reader, and they come first.

### 8. What English changes for accessibility

- `lang` must switch per page (done by the routing in §4.1), and product names need `lang="lv"` (item 3).
- English copy should be reviewed for reading level like the Latvian: short sentences, the price and the date in the first line, no idioms. The question texts are the most important.
- Dates and numbers in the English conventions (§3.3) also help screen readers, which read "€599" correctly in English and stumble on "599 €".
- Pluralisation and gender are simpler in English, but every ICU `plural` in `lv.json` needs its `one`/`other` branches checked in `en.json`.

### 9. Order of work for Part B

1. Skip link, arrow-key radios, `lang` on product names, `h2` outline, link purposes (items 1–4, 8): one PR with the all-routes axe test (item 9).
2. The chart values and the 14 px meta lines (items 5–6), with screenshots at 360 px.
3. The bilingual error page (item 7) rides the English routing PR.
4. The legal "Īsumā" summaries (item 10) ride the English translation PR, because they are written at the same time in both languages.
