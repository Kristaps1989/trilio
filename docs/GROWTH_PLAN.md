# Growth plan: paid traffic with a daily Claude optimiser

Owner request, 24 Oct 2026: bring more visitors; Google Search ads as the first idea, open to better ones. The owner sets a daily budget and nothing else. Claude evaluates results every day, adjusts keywords and strategy, and writes the display and video creatives. Everything is managed from the admin panel.

Status: **built (24 Oct 2026), with every §10 decision as recommended.** Off until `FEATURE_ADS=1` and the Google credentials are set; campaigns are created paused, so nothing is spent until the owner switches them on in `/admin/reklama/kampanas`.

What shipped and what did not:

- **Built:** Consent Mode v2 and cookieless ad attribution (§5 Phase 0), Search campaigns from the category data (Phase 1), the daily optimiser in Approve mode with guardrails, honesty lint and the weekly memo (Phase 2), the creatives gallery with Claude copy, brand-template images and video storyboards (Phase 3), Performance Max per category group (Phase 4), Search Console ingestion and the SEO page, and the admin section "Reklāma".
- **Review cadence (owner, 24 Oct 2026):** Claude reviews the account **weekly** by default, on Monday. At 15 € a day one day's data is mostly noise. Reports, Search Console and the budget rule still run every morning, without a model call. The owner can switch to daily reviews or another weekday under Reklāma → Iestatījumi. "Palaist optimizētāju tagad" runs a review at once.
- **Reports from Google (25 Oct 2026):** Trilio pulls Google's numbers every hour for the last three days, today included, on a timer of their own that shop ingestion cannot hold up. It also pulls the account total (`FROM customer`), so "Tēriņi" in the admin matches the Google Ads overview, including campaigns made in Google Ads directly. These are shown apart. "Atjaunināt datus no Google" pulls at once. The overview shows when the data was last pulled and why a pull failed. Google itself revises the last hours, so today's numbers can still change slightly.
- **Addressable TV (owner, 26 Oct 2026):** Go3 campaigns are measured by Trilio's own impression tracker (`/px/<campaign>`, filled by Go3's ad server with the device id) and a short link (`/tv/<campaign>`) for the screen or a QR code. Reklāma → TV shows impressions, reach, short-link openings, visits and shop clicks. Setup: `docs/ADS_SETUP.md` §6.
- **Competitor campaign (owner request, 24 Oct 2026):** "Search · Konkurenti" bids on price-comparison searches, mainly kurpirkt.lv and salidzini.lv (`competitors` in `data/keywords.lv.json`). Bidding on a competitor's name is lawful in the EU when the ad does not suggest a connection (CJEU C-236/08 Google France, C-323/09 Interflora). So the ad text never names them: the honesty lint blocks competitor names in any ad, and the guardrails stop Claude from adding a negative that would block these keywords.
- **Deferred:** Demand Gen needs real YouTube videos, and Meta retargeting needs a pixel and an audience of at least 1 000 people. Both wait until there is traffic. Video is a storyboard for Google's Asset Studio or a human editor, not a rendered file.
- **Not yet verified live:** the Google Ads and Search Console clients follow the REST documentation and are unit-tested against recorded shapes, but they have not run against a real account. Run "Sinhronizēt" once with the account connected and check `/admin/reklama` before switching campaigns on.

---

## 1. Summary

1. **Google Search is the right first channel**, because appliance buyers in Latvia search by category and budget, which is exactly what Trilio answers. But it only pays if a visit is worth more than a click costs, and today we cannot measure that. So the first two weeks are measurement, not ads.
2. **The daily optimiser is Claude inside guardrails written in code.** Claude reads the reports, joins them with Trilio's own data, and proposes bounded changes (keywords, negatives, bid caps, budget split, ad copy). Code checks every proposal against hard limits before it reaches Google. The owner's daily budget is a ceiling Claude can never raise.
3. **Claude writes creatives; it does not draw them.** Claude produces copy, scripts and briefs. Images and videos come from two sources: Trilio's own template renderer (on-brand, built from real product data, free) and Google's built-in asset generation inside Performance Max and Demand Gen. A third-party image model is an option for later, not a requirement.
4. **Order:** measure → Search → optimiser → creatives → Performance Max/Demand Gen → Meta. SEO runs in parallel from day one, because it compounds and costs nothing per click.
5. **Budget guidance:** start at 10–20 €/day, raise only when cost per shop click is below what a shop click earns (§3).

## 2. What exists today

- Visitors reach the site by direct links, the category landing pages (`/kategorija/{sub}`, `/lidz-{eur}`), and the sitemap. A Search Console verification token is supported but no Search Console data is read.
- GA4 is opt-in behind the consent banner; first-party stats (no cookies) count sessions, questions and shop clicks in the admin.
- Every shop click is a row in `affiliate_clicks`; nothing records which ad or keyword brought the visitor (no `gclid`, no UTM handling).
- Claude already runs behind a daily call cap with usage accounting per purpose (`src/services/llm/client.ts`), and a scheduler runs jobs on the web service every 15 minutes.
- The admin has sections for today, statistics, users, demand, offers, orders and system. There is nothing about traffic sources.

## 3. The economics gate

A click is worth: `share of visits that click a shop × shop conversion × average order × commission`.

Illustration (fill in the real numbers in Phase 0):

| Input | Guess | Where it comes from |
|---|---|---|
| Visits that click through to a shop | 25 % | admin statistics, already measured |
| Shop conversion after the click | 2 % | the partner's affiliate reports |
| Average order | 450 € | partner reports |
| Commission | 3 % | the partner contract |
| **Value of one visit** | **0,07 €** | product of the above |

At those guesses a visit is worth about 7 cents, and Latvian CPCs for generic appliance terms are likely 0,10–0,40 € (to be measured; Keyword Planner gives estimates once the account exists). So paid search at these numbers loses money per click and must earn its keep elsewhere: saves to the wishlist (which later become Trilio's own offer sales with a much larger margin), returning visitors, and SEO signals. The plan therefore optimises for **two conversions**: a shop click (`affiliate_click`) and a save (`save`), weighted in the admin.

**Rule:** the optimiser may raise spend only while the 7-day cost per weighted conversion is under the target the owner sets in the admin. Otherwise it holds or lowers the budget, down to a floor the owner sets.

## 4. Channels evaluated

| Channel | Fit for Trilio | Cost | Automation via API | Verdict |
|---|---|---|---|---|
| **Google Search (keyword campaigns)** | High: intent matches category pages. Latvian keyword data is thin but usable. | CPC 0,10–0,40 € (estimate) | Full: keywords, negatives, ads, bids, budgets through the Google Ads API | **First.** |
| **Performance Max** | Medium: reaches Search, YouTube, Display, Gmail from one asset group; Google generates images and video in-platform. Less control, needs ≥ 30 conversions/month to learn. | Same budget | Full, but keyword control is limited to search themes | **Second**, once conversions flow. |
| **Demand Gen (YouTube, Discover, Gmail)** | Medium: awareness; video creatives needed. | CPM-based | Full | With Performance Max. |
| **Google Shopping via the CSS programme** | Strong in principle for a comparison site (ads in the Shopping unit), but needs offers from ≥ 50 merchant domains per country; Trilio has 3 shops and Latvia is not on Google's CSS country list. | — | — | **Not now.** Revisit at 50 shops or when Latvia is added. |
| **Meta (Facebook, Instagram)** | Medium: large Latvian audience, weak intent; good for retargeting savers and wishlist users. | CPM | Full (Marketing API) | After Google, as retargeting. |
| **Microsoft Ads (Bing)** | Low volume in Latvia (Bing ≈ 4 % of searches). | Low | Full | Later; import the Google campaigns in one click. |
| **SEO and content** | High: category pages exist; knowledge.json gives real guide content; Search Console data can feed the same optimiser. | Free per click | Search Console API read-only | **In parallel from day one.** |
| **Partnerships (Latvian portals, bank "lifestyle" pages, comparison aggregators)** | Medium; manual | Negotiated | None | Owner's time; not in this plan. |
| **E-mail (wishlist alerts)** | Already built; retention, not acquisition | Free | — | Keep. |

## 5. Phases

### Phase 0 — Measurement and accounts (weeks 1–2, no ad spend)

1. **Consent Mode v2 (basic mode).** The existing banner gains the `ad_storage`, `ad_user_data` and `ad_personalization` signals. Google requires v2 for EEA conversion measurement; basic mode (nothing loads before consent) matches the current GA4 setup and the privacy policy. The policy gains a paragraph on Google Ads conversion measurement.
2. **First-party attribution that needs no consent.** When a visit lands with `gclid` (or `utm_*`), store it on the search session (hashed visitor id, as the statistics already do) and copy it to `affiliate_clicks` and `saved_items`. This is Trilio's own count, so the optimiser never depends on consent rates.
3. **Google Ads conversions.** Two key events imported from GA4 (`affiliate_click`, `save`) for Google's bidding; the first-party join is the source of truth in the admin.
4. **Accounts.** The trilio.lv Google Ads account (billing in euro) and the existing Google Cloud project of the sign-in, with the Google Ads API enabled and **Explorer** access (usually automatic). The project's service account is added as a user in Google Ads. Developer tokens and the API Center were retired by Google on 9 Sep 2026, and no manager account is needed. Steps: `docs/ADS_SETUP.md`. Search Console property verified with the existing token.
5. **Keyword Planner export** for the 39 subcategories in Latvian: volumes and CPC ranges, saved as `data/keywords.lv.json`. Claude drafts the seed list from `categories.json` + `knowledge.json`; the owner reads it.

### Phase 1 — Search campaigns (weeks 2–4)

- **Structure:** one campaign per category group (cool, wash, kitchen, small kitchen, clean, personal care), one ad group per subcategory, 10–30 keywords each in phrase and exact match, Latvian, Latvia only, all devices, no search partners at first.
- **Ads:** responsive search ads written by Claude from the subcategory's questions and knowledge ("Ledusskapis 3–4 cilvēkiem? Atbildi uz 4 jautājumiem — 3 varianti ar cenu salīdzinājumu"). Honesty rules apply verbatim: no "garantēti lētākais", no countdowns, no invented discounts; Omnibus applies to any price claim in an ad as on the site.
- **Landing pages:** the flow's first question (`/izvelies/{group}/{sub}`) for intent-rich terms, the category page (`/kategorija/{sub}`) for "labākie …" terms. Every landing URL is checked for a 200 before an ad is saved.
- **Negatives from day one:** repairs, spare parts, manuals, jobs, rentals, second-hand, brands we do not list, retailer brand names (D4).
- **Bidding:** Maximize clicks with a CPC cap for the first 2–3 weeks, then target CPA on the weighted conversion once there are 30 conversions in 30 days.
- **Budget:** the owner enters one number in the admin. Code sets the campaign budgets to split it (initially by keyword volume), and Google's own daily cap is the hard stop. Note Google may spend up to 2× the daily budget on a single day but never more than 30,4× in a month; the admin shows the month-to-date figure.

### Phase 2 — The daily optimiser (weeks 3–6)

Runs every morning at 06:30 Riga time after Google's reports settle, as a job in the existing scheduler.

1. **Pull:** yesterday, 7-day and 28-day reports (campaign, ad group, keyword, search terms, ad, hour, device, location) through the Google Ads API; Search Console queries and pages for the same window; Trilio's own sessions, shop clicks, saves and confidence answers joined by `gclid`.
2. **Reason:** one Claude call (`claude-opus-5-5`, adaptive thinking, `effort: "high"`, structured output) with the reports, the current state, the guardrails and the owner's targets. It returns a list of proposals, each `{ action, target, params, reason, expectedEffect, confidence }` from a closed set of actions:
   - add or remove a negative keyword (from search terms);
   - pause or re-enable a keyword or ad;
   - add a keyword from a search term that converted;
   - change an ad group's CPC cap;
   - move budget between campaigns within the owner's total;
   - propose a new responsive-ad headline or description;
   - flag a landing page that underperforms (bounce, no question answered).
   Search-term classification for long lists uses `claude-haiku-5-5` first, so the daily Opus call stays small.
3. **Guardrails in code, not in the prompt:** total budget never above the owner's number; a single campaign budget moves at most 20 % per day; at most 25 changes per day; keywords must be Latvian or a known model code; negatives cannot remove a converting term; ad text passes the honesty lint (banned phrases, no numbers that are not in the data, no claims about shops we do not list) and the landing URL check; campaign status, currency, geography and conversion settings are never touched by the agent.
4. **Modes** (owner's switch in the admin): *Observe* (proposals only), *Approve* (owner ticks each), *Auto* (apply within guardrails, owner sees the log). Recommended: Approve for the first four weeks, then Auto for keywords and negatives, Approve for budget moves and new ads.
5. **Weekly strategy memo** (Monday): what worked, what to stop, categories to add or drop, a budget recommendation, and anything the guardrails blocked. New campaigns and new categories are always Approve.
6. **Cost:** about 60 k input and 5 k output tokens a day on Opus 5.5 at $4 / $20 per million ≈ $0,35 per day, plus the Haiku classification and the weekly memo: under $15 a month. Counted in the existing LLM usage table under a new purpose `ads_optimiser`, with its own daily call cap.

### Phase 3 — Creatives (weeks 5–8)

Claude writes; two renderers draw.

1. **Copy by Claude:** headlines, descriptions, sitelinks, callouts, image briefs, 6–15 s video scripts with on-screen text, all in Latvian (English under `/en` later). Every text runs through the honesty lint.
2. **Trilio template renderer (recommended first):** HTML templates in the brand (Nakts zaļš, lime, Space Grotesk/Figtree, docs/BRAND.md) rendered by the Playwright already in the stack to the standard display sizes (300×250, 336×280, 728×90, 320×50, 1200×628, 1080×1080, 1080×1920) and to short MP4 "three options" animations (frames → ffmpeg). Inputs are real: the category illustration, three picks with real prices from the live ranking, the coverage line ("Izskatījām 47 ledusskapjus 3 veikalos"). Deterministic, on-brand, free, and the numbers can be regenerated daily so prices stay true.
3. **Google's in-platform generation** (Asset Studio in Performance Max and Demand Gen: images and short videos from product images) for lifestyle variants. Free, policy-checked by Google, no API work; language support for Latvian prompts must be confirmed in the account (Claude can write the prompts in English).
4. **Third-party image or video models** (for example Imagen or Veo on Vertex AI, billed per image or per second): only if the owner wants photographic lifestyle scenes the templates cannot give. Not in the first delivery.
   *As built (27 Oct 2026):* the template follows the owner's brand videos: copy on the left (category chip, headline, body, "Sākt izvēli" button, coverage line) and three result cards on the right (Labs €, Labāks €€ with the lime ring and "Labākā izvēle tev", Labākais €€€) drawn with the category's illustration. It shows price levels, not prices, so an approved image never shows a stale number. The fonts are one file per weight holding both Google subsets (satori keeps only the first file of a name and weight, which made ā, š, ķ fall back to a default font). Claude's headline is built on one deciding factor from knowledge.json, picked at random on each "Ģenerēt", so drafts vary.
5. **Gallery in the admin:** every creative is previewed and approved by the owner before upload. Uploaded assets are tracked with their Google asset id and performance.

### Phase 4 — Performance Max and Demand Gen (weeks 8–10)

One Performance Max campaign with asset groups per category group, using the Phase 3 assets and search themes from the best Search keywords; one Demand Gen campaign with the video assets for the two best categories. Same budget ceiling, same optimiser, same guardrails. Meta retargeting of savers follows when the wishlist audience is large enough (≥ 1 000).

### SEO track (from week 1, parallel)

- Search Console data flows into the same daily job; the optimiser reports queries where Trilio ranks 5–20 and proposes content (FAQ lines from knowledge.json, "labākie X līdz Y €" pages already exist, missing categories).
- Category guide sections from `knowledge.json` (what decides, watch-outs) rendered on `/kategorija/{sub}` with FAQ structured data.
- Internal links from the results page to the landing pages; LT/EE later.

## 6. Admin panel: "Reklāma"

| Page | Shows | Does |
|---|---|---|
| **Pārskats** | Spend today / month, clicks, CPC, shop clicks and saves from ads, cost per weighted conversion vs target, estimated commission, GA vs first-party counts | Daily budget (one number), floor, target cost per conversion, mode switch, **pause all** |
| **Kampaņas** | Campaigns and ad groups with status, budget share, 7/28-day numbers | Nothing manual except pause; structure changes go through proposals |
| **Priekšlikumi** | Today's proposals with reason, expected effect, confidence; applied / rejected / blocked-by-guardrail log | Approve, reject, "always allow this type" |
| **Atslēgvārdi** | Keywords, negatives, search terms with Trilio's own conversions | Add negative by hand; export |
| **Reklāmas** | Ads and the creative gallery with previews and performance | Generate copy, render creatives, approve, upload |
| **Stratēģija** | Weekly memos, budget history, decisions | Comment back to the agent (goes into next week's context) |
| **SEO** | Search Console queries and pages, content proposals | Mark done |
| **Iestatījumi** | Account link status, API quota used, LLM spend, last run | Reconnect OAuth, run now |

Every automated change is written to the admin audit log with the proposal id, so the owner can always see why Google's account looks the way it does.

## 7. Data model and code

- Tables: `ad_accounts` (customer id, OAuth, status), `ad_campaigns`, `ad_ad_groups`, `ad_keywords` (with negatives), `ad_ads`, `ad_creatives` (file, size, approval, Google asset id), `ad_daily_stats` (per entity per day), `ad_search_terms`, `ad_agent_runs`, `ad_proposals` (status, applied change id), `ad_changes` (what was sent to Google, response), `seo_queries`.
- Columns: `gclid`, `utm_source/medium/campaign` on `search_sessions`, `affiliate_clicks`, `saved_items`.
- Services: `src/services/ads/google.ts` (API client via `google-ads-api`, the Opteo Node library, or REST; mutations in one place), `src/services/ads/report.ts` (pull and store), `src/services/ads/optimiser.ts` (prompt, structured schema, guardrails), `src/services/ads/creatives.ts` (templates, Playwright render, ffmpeg), `src/services/seo/search-console.ts`.
- Domain, pure and unit-tested: `src/domain/ads/guardrails.ts` (every limit in §5.2.3), `src/domain/ads/honesty.ts` (banned phrases, number-in-data check), `src/domain/ads/budget.ts` (split and bounds).
- Claude call: `createCaller` with purpose `ads_optimiser`, model `claude-opus-5-5`, `output_config.format` JSON schema for proposals, the stable part of the prompt cached.
- Env: `GOOGLE_SERVICE_ACCOUNT_KEY` (or the OAuth alternative `GOOGLE_ADS_CLIENT_ID/SECRET` plus `GOOGLE_ADS_REFRESH_TOKEN`), `GOOGLE_ADS_CUSTOMER_ID`, optional `GOOGLE_ADS_LOGIN_CUSTOMER_ID`, `FEATURE_ADS=0/1`. Never in the repo; `.env.example` documents them.

## 8. Compliance

- Consent Mode v2 basic; privacy policy paragraph; `gclid` kept 90 days, tied to the hashed visitor id only.
- Ads follow the same honesty rules as the site (CLAUDE.md rule 4) and Google's misrepresentation policy; discount claims in ads use the 30-day low like the site.
- Commission never affects ranking; ads only bring visitors to the same deterministic results.
- No bidding on partner retailers' brand names (D4) and no competitor names in ad text.
- The automation uses the official API under the Cloud project's Explorer access for Trilio's own account; Google's Required Minimum Functionality rules apply only to tools sold to third parties.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Clicks that never earn back (likeliest) | Economics gate (§3); start small; the optimiser lowers the budget to the floor when cost per conversion is over target for 7 days |
| Google overdelivery (2× daily) | Month-to-date cap in the admin; pause-all |
| API access approval delays | Explorer is usually automatic; Basic needs brand verification, so apply only if quota runs short |
| Consent refusals hide conversions from Google | First-party `gclid` join is the admin's truth; Google gets GA4 imports as a second signal |
| Claude proposes a wrong keyword or claim | Closed action set, guardrails and honesty lint in code, Approve mode first, full log |
| Latvian keyword data is thin | Phrase match plus search-term mining; Claude expands from real queries |
| Creative quality | Owner approves every creative; templates use real data only |

## 10. Decisions for the owner

| # | Decision | Recommended |
|---|---|---|
| D1 | Channel order: measurement → Google Search → optimiser → creatives → Performance Max/Demand Gen → Meta; SEO in parallel | **Yes** |
| D2 | Optimiser mode: Approve for four weeks, then Auto for keywords and negatives, Approve for budgets and new ads | **Yes** |
| D3 | Creatives: Trilio template renderer plus Google's in-platform generation; no third-party image model in the first delivery | **Yes** |
| D4 | Do not bid on partner retailers' brand names | **Yes** |
| D5 | Starting daily budget 15 €, floor 5 €, month cap shown; target cost per weighted conversion set after Phase 0 data | **Yes** |
| D6 | Conversions: shop click weight 1, save weight 3 (owner can change) | **Yes** |
| D7 | Models: `claude-opus-5-5` for the daily reasoning and the memo, `claude-haiku-5-5` for search-term classification | **Yes** |
| D8 | Ask the partner shops for their affiliate conversion and order data so §3 uses real numbers | **Yes, owner's action** |

## 11. Delivery

| PR | Content | Effort |
|---|---|---|
| A | Consent Mode v2, `gclid`/UTM capture, GA4 key events, privacy text, account and API setup docs, Keyword Planner seed list | 1 week |
| B | Google Ads client, campaign builder from `categories.json`, budget control, admin Pārskats/Kampaņas/Atslēgvārdi, first campaigns in Observe mode | 1–2 weeks |
| C | Daily optimiser, guardrails and honesty lint with unit tests, proposals and log pages, weekly memo, Search Console ingestion and SEO page | 1–2 weeks |
| D | Creative templates, renderer, gallery, asset upload | 1–2 weeks |
| E | Performance Max and Demand Gen campaigns, Meta retargeting | 1 week |

About 6–8 weeks of work plus Google's approval time; ad spend starts at the end of PR B, and the first month runs in Approve mode.
