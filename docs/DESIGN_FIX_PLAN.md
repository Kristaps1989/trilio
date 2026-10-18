# Design fix plan: match the Claude Design prototype

Source of truth: `design/prototype/Main.dc.html` (guided flow, results,
login, payment), `design/prototype/Alerts.dc.html` (price radar),
`design/prototype/Brand.dc.html` and `docs/BRAND.md`. Screenshots of the
current build at 1440 px and 390 px were compared with the prototype
markup on 18 Oct 2026.

## 0. Urgent: the live site has errors (checked 18 Oct 2026)

| Finding on https://trilio.lv | Evidence | Fix |
|---|---|---|
| Every page that reads the database returns HTTP 500 | `/kategorija/*`, `/izvelies/<group>/<sub>`, `/rezultati`, `/modelis?q=…`, `/go/…` and `POST /api/free-text` all return 500, while `/api/health` returns `{"ok":true}` and pages without database reads load | Confirmed 18 Oct: the logs say `relation "products" does not exist` and the Postgres Data tab shows no tables. The pre-deploy step `npm run db:release` left the database empty. Fix: migrations now run in the start command (`npm run start:release`) and log the target database and table count. Code: `/api/health` checks the schema too (`select 1 from stores limit 1`), so a deploy with a missing schema fails its health check instead of going live; the migration logs which migrations it applied |
| The same pages pass locally | The same build against a fresh database prepared by `npm run db:release` and against real scraped products returns 200 | Confirms the cause is the production database state, not the page code |
| `www.trilio.lv` does not resolve | No DNS record | Cloudflare: CNAME `www` to the Railway target and add `www.trilio.lv` as a custom domain in Railway, or a Cloudflare redirect rule from `www` to `trilio.lv` |
| Error and 404 pages are the default English Next.js screens | "This page couldn't load", "404: This page could not be found" | Branded Latvian `not-found.tsx`, `error.tsx` and `global-error.tsx` inside the normal header and footer, with "Mēģināt vēlreiz" and a link home |
| CI never caught the 500s | The e2e suite runs only against a database seeded with sample products | Add the production smoke test and the empty-database run described in section 5 |

These ship first, as PR 0, before any design work.

## 1. What is wrong today

| Problem | Cause in the code | Prototype |
|---|---|---|
| Desktop looks like a stretched phone | No content-width containers: `Shell` renders `main` at full width, so buttons, option rows and cards span 1 440 px | Every screen sits in a centred column: 480 px (login, payment), 720 px (questions), 760 px (welcome, radar), 1 160 px (results) |
| Results are a long single column | Result cards are full-width blocks stacked vertically | Three white cards side by side (`flex: 1 1 300px`), wrapping to one column on phones |
| Category pickers are two huge columns | Fixed 2-column grid at full width | Tile grid `repeat(auto-fill, minmax(150px, 1fr))`, 112 px tiles, inside 720 px: four to five per row on desktop |
| Header and footer "move" | (1) On Windows the scrollbar appears only on long pages, shifting the whole layout about 15 px sideways between pages. (2) Header and footer are rendered by each page (`Shell`, plus a different copy on `/`), so they re-mount and change on every navigation. (3) The footer is two rows whose height depends on the back link | One header and one footer for all screens; the footer is a single row (back button left, tagline right) |
| Screens feel cramped and plain | Content is top-aligned; headings are 28 px; no kicker lines; buttons are full-width bars | Flow screens are vertically centred; headings scale with `clamp()` up to 64 px; lime uppercase kicker; buttons sized to their label and placed inline |
| Header differs from the design | Text link "Cenu radars", outlined "Ienākt" | Pill buttons: outlined "Cenu radars" with radar icon, solid light "Ienākt", lime avatar initial when signed in |
| Progress bar sits inside the content | `ProgressBar` above the question | 4 px bar across the very top of the viewport, above the header |
| Question screens lack guidance | No "why we ask" line; options span the full width | Lime counter, title, description, options max 540 px with letter badges, "Kāpēc jautājam:" line under the options |

The phone layout is close to the design; the desktop layout was never
designed in code. Most fixes are therefore layout and component work, not
new features.

## 2. Design tokens to add

Already in `globals.css`: night, lime, mist, stone, muted, refurbished,
over-budget, best, warning.

Add, all taken from the prototype:

| Token | Value | Used for |
|---|---|---|
| `line-30` / `line-40` | `rgb(242 245 242 / 0.30)`, `0.40` | Outlined buttons and pills on dark |
| `chip` | `rgb(242 245 242 / 0.10)` | Answer chips, status bars |
| `card-pill` | `#EDF1EE` | Tier pill on white cards |
| `card-line` | `#E3E8E5` | Dividers inside white cards |
| `card-button-line` | `#C9D3CF` | "Sekot cenai" outline |
| `success` | `#2E6B1F` | Savings, "Filtri saglabāti" |
| `refurb-ink` / `refurb-ink-2` | `#17327A`, `#33456E` | Text on the refurbished card |
| `lime-12` | `rgb(216 244 90 / 0.12)` | Help and info boxes |

Type scale (Space Grotesk 600, negative tracking):

| Role | Size |
|---|---|
| Welcome title | `clamp(34px, 6.4vw, 64px)`, line-height 1.04 |
| Results title | `clamp(30px, 4.6vw, 48px)` |
| Screen title (questions, login, radar) | `clamp(26px, 4.4vw, 40px)` |
| Price on cards | 38 px, weight 700 |
| Kicker | 14 px, weight 700, lime, `letter-spacing: 0.04em`, uppercase |
| Lead text | `clamp(17px, 2.2vw, 20px)`, stone |

Radii: buttons 12 px (52 px tall) and 14 px (56 px tall); cards 20 px;
panels 18 to 22 px; pills 999 px. Side padding: `clamp(16px, 4vw, 40px)`.

## 3. Plan

Four pull requests, each releasable on its own and each verified at 360,
390, 768, 1 280 and 1 440 px.

### PR 1: Foundation (fixes the moving header and footer and the stretched desktop)

1. `html { scrollbar-gutter: stable; }` so the layout no longer shifts when a page gets a scrollbar.
2. One `AppShell` in `src/app/layout.tsx`: the progress bar slot, header and footer render once and persist across client navigation. Pages render only their content. `Shell` and the separate header and footer on `/` are removed.
3. Header per the prototype: logo button, "Cenu radars" outlined pill with radar icon, "Ienākt" light pill, or the lime initial avatar when signed in. Buttons are 44 px tall rather than the prototype's 40 px, because CLAUDE.md requires 44 px touch targets.
4. Footer per the prototype: a single row with the 48 px square back button on the left (only where a back step exists) and the tagline on the right. The legal links sit in a second, fixed row on every page, so the footer is always the same height.
5. Layout primitives in `src/ui/`: `Container` (sizes `narrow` 480, `form` 720, `text` 760, `wide` 1 160), `Screen` (vertically centred flow screen), `Kicker`, `PageTitle` (the three type scales), `Lead`.
6. Button set matching the prototype: `primary` (lime, 52 or 56 px), `outline` (line-40), `dark` (night on white cards), `light`, `link` (underlined text). Buttons size to their label unless `block` is set.
7. Tokens and type scale from section 2.

### PR 2: Guided flow

1. Welcome (`/`): kicker "PIRKUMU PALĪGS · SADZĪVES TEHNIKA", 64 px title, lead, two inline buttons, the meta line "Aizņem apmēram minūti · bez reģistrācijas · …". The SEO sections ("Kā Trilio strādā" and the category links) stay below the fold in a 1 160 px container, restyled as tiles and chips.
2. Group and subcategory pickers: tile grid per the prototype (icon at top, label at bottom, 112 px, "Kaut kas cits" full width).
3. Question screen: top progress bar, lime counter ("1 / 7"), title, description, options capped at 540 px with 28 px letter badges, numeric input as a large underlined Space Grotesk field with unit, inline "Turpināt" with a "Nezinu" link beside it, and the "Kāpēc jautājam:" line from `categories.json`.
4. Free text (`/cits`) and the waitlist state: underlined input with an inline button, as in the prototype's "soon" screen.
5. Model check (`/modelis`): same pattern as the question screen.
6. Optional: the prototype's "Meklējam tev labākos variantus…" screen as a short loading state before results.

### PR 3: Results and category pages

1. Results header: kicker, 48 px title, lead, answer chips, the EAN line and the "Kā mēs izvēlamies un ranžējam?" toggle opening the bordered explanation panel.
2. Result cards in a row of three (one column on phones). Each card has:
   - **Top row:** tier pill, the "Trilio ieteikums" pill and the score on the right.
   - **Product:** name at 20 px, ID line, specs.
   - **Price line:** 38 px price with shop and stock.
   - **Price notes:** the 30-day low, the upgrade delta box (`best` background) and the energy line.
   - **Why it fits:** the reasons, each with a check icon.
   - **Other shops:** the other offers below a divider, plus the saving.
   - **Buttons:** a dark "Pirkt — shop" button and an outlined "Sekot cenai" button, stacked at the bottom.
   - **States:** the recommended card has a 3 px lime ring; over-budget cards have a dashed border and the over-budget pill.
3. Compare: a lime-outline toggle button with a "Rādīt tikai atšķirības" checkbox, opening a white table with a sticky label column.
4. Refurbished: separate blue horizontal card under its own heading.
5. Radar call to action: lime-outline panel with "Ieslēgt cenu radaru".
6. Bottom actions: "Mainīt atbildes" outlined button and "Sākt no jauna" link.
7. Category landing pages (`/kategorija/...`) reuse the same header and three-card row, with the "answer a few questions" call to action as a panel rather than a full-width bar.

### PR 4: Account, radar, sign-in and content pages

1. Sign-in (`/ienakt`): 480 px column, kicker, title, then the Google button built to Google's sign-in branding guidelines: the official multicolour "G" logo, a white background, a `#747775` border and `#1F1F1F` text reading "Turpināt ar Google". Today it is a dark button without the logo, which Google's brand review can reject. Below it: a "vai" divider, a boxed email field with an outlined submit button, and the 13 px consent line. Also hide the header "Ienākt" button on the sign-in page itself.
2. Plan and payment (`/radars/jauns`): the prototype's plan box (lime border, 44 px price, check list), the legal note and the primary pay button. Card entry stays on Paysera's hosted page, so the prototype's card form is not built.
3. Confirmation (`/radars/apstiprinats`): lime check circle, title, text and two inline buttons.
4. Radar (`/radars`), following `Alerts.dc.html`:
   - **Page:** 760 px column with kicker and headline.
   - **Radar card:** each tracked product is a white card with an on/off switch, price at 38 px with a change pill, and a 30-day price sparkline.
   - **Inside the card:** a collapsible "Filtri" panel with chip buttons, a "similar model" box, and the buy and stop buttons.
   - **Below the cards:** the "Kā paziņot" and "Abonements un apmaksa" sections.
5. Account (`/konts`) and the legal pages: 760 px text column with the kicker and title pattern.
6. Consent banner: aligned to the same container and button styles.

## 4. Deliberate differences from the prototype

| Prototype | Build | Reason |
|---|---|---|
| Header buttons 40 px | 44 px | CLAUDE.md: touch targets at least 44 px |
| Apple sign-in and Apple Pay | Not shown | Apple sign-in deferred (owner decision, 18 Oct 2026); Paysera hosted checkout |
| Card form on our page | Paysera hosted page | Card data must never touch our servers |
| "1 € mēnesī" | 1,99 € a month or 12 € a year | Owner decision on pricing |
| No legal links in the footer | Fixed second footer row | Legal pages must be reachable from every page |

## 5. End-to-end validation

Three layers, so that an error like the current 500s cannot reach users unnoticed again.

1. **CI, sample data (exists today).** The full Playwright suite at 360 px and desktop, against a database seeded with sample products.
2. **CI, empty database (new).** The same server started against a database prepared by `npm run db:release` only: partner shops, no products. Every public route must render a proper page or an empty state, never a 500. This is the state a fresh production database is in.
3. **Production smoke test (new).** A read-only Playwright suite run against `https://trilio.lv` after every deploy to `main`, and hourly. It changes no data, so it is safe in production.
   - **Every sitemap URL:** opened and checked for a status under 400, no Next.js error screen, the Trilio header present and Latvian text.
   - **Full flow:** home → category → every question → results, then the comparison table and a click on "Pirkt" that must reach the shop domain.
   - **Other routes:** `/modelis` search, `/cits` free text, sign-in page with the Google button, legal pages, `robots.txt`, `sitemap.xml`, `llms.txt` and `/api/health`.
   - **Hosts:** `http://` redirects to `https://`, and `www.` redirects to the main domain.
   - **On failure:** a red GitHub check and an email to the owner, with the failing URL and the error digest.

Per-PR verification of the design work:

- **Screenshots:** Playwright screenshots of each changed screen at 360, 390, 768, 1 280 and 1 440 px, reviewed next to the prototype canvas before merging.
- **New end-to-end checks:**
  - The header and footer keep the same position and size across a client navigation.
  - There is no horizontal scroll at 360 and 1 440 px.
  - Main content never exceeds its container width.
  - Cumulative layout shift stays under 0.05 on `/`, a question and the results page.
- **Existing checks keep passing:** axe accessibility checks, the 44 px touch-target test, the analytics events (selectors updated where the markup changes), and the unit tests.

## 6. Open points for the owner

1. **Latest design version:** if the Claude Design canvas changed after the handoff zip of 17 Oct, export it again and the PRs follow the newer version. The plan above follows the zip.
2. **Loading screen:** keep the optional "Meklējam…" loading screen before results (PR 2, step 6), or show results immediately.
