# Meta ads: getting to know Trilio + "Pieprasīt labāku cenu" (plan, 31 Oct 2026)

Owner's goal: paid Facebook and Instagram ads that bring people **to the site**, so they get to know Trilio (a few questions, three suitable picks) and **request a better price** on a product. Organic posts already run (docs/SOCIAL_PLAN.md); this plan is the paid layer.

Sources for "2026 practice" are Meta's own Ads Manager behaviour plus agency write-ups of the Andromeda ad-retrieval change (see the end). Where those disagree or cannot be checked, this plan says so and takes the conservative choice.

## 1. What success means

| Stage | What we count | Where |
|---|---|---|
| Arrive | Landing page views from Meta (`utm_source=meta`) | Meta Ads Manager; Admin → Statistika (`ad_landings`) |
| Get to know | Visits that answer the first question / reach results | GA4 `answer_question`, results `page_view` |
| **Request** | "Pieprasīt labāku cenu" registered (e-mail given), then confirmed | Admin notify funnel (`notify_tap` → `notify_sent` → `notify_confirmed`); Meta event `Lead` |
| Money | Shop clicks, paid Trilio offers | `select_offer`, orders |

The one number to steer by is **cost per request** (`Lead`). Clicks and views are only health checks.

## 2. Before any spend (week 0)

This part decides whether the campaign can learn. Today the site sends events to GA4 and Google Ads, **not to Meta**: without the Meta Pixel, Meta can only optimise for raw link clicks, which buys the cheapest, least interested clicks.

1. **Meta Pixel + Conversions API (I build this; ~1 day).** Loaded only after "Atļaut" in the existing consent banner, like Google Ads. Events, each sent from the browser and from the server with the same `event_id`, so Meta counts them once:
   - `PageView` on every page;
   - `ViewContent` when the results page shows picks (category as `content_category`);
   - **`Lead` when a better-price request is registered** (the server confirms it, so it is never counted for a failed form);
   - custom `ShopClick` on "Pirkt …" (measured, not optimised for).
   Nothing personal is sent in plain text: no answers, no free text, no product the person typed. The e-mail of a request is sent **hashed** (SHA-256) only with the `Lead` event and only when the visitor accepted cookies, which improves matching. A visitor who declined sends nothing, from the browser or the server.
   Privacy policy and the cookie banner text get one line each: Meta as a recipient for ad measurement.
2. **Business portfolio** (business.facebook.com): the Trilio page, the Instagram account and an ad account in one portfolio; payment method; ad account currency **EUR**, time zone **Europe/Riga** (cannot be changed later).
3. **Domain verification:** Business settings → Brand safety → Domains → add `trilio.lv` → DNS TXT record at the domain registrar. Needed for the Pixel's events to count without limits and to edit link previews.
4. **Dataset (Pixel):** Events Manager → Connect data sources → Web → name "Trilio" → copy the **Dataset ID** and create a **Conversions API access token** (Settings → Generate access token). Send both to me; they go to Railway as `META_PIXEL_ID` and `META_CAPI_TOKEN`, never into the code.
5. **Check:** Events Manager → Test events → open trilio.lv, accept cookies, answer a question, request a better price → `PageView`, `ViewContent`, `Lead` appear, marked "Browser and server", deduplicated. Event match quality "Good" or better for `Lead`.

## 3. Strategy

**Message, two halves, always together:** what Trilio is (*daži jautājumi, trīs piemērotākie varianti no veikaliem*) and the one thing nobody else offers (*pieprasi labāku cenu: pajautāsim izplatītājam; ja varēsim lētāk, atsūtīsim piedāvājumu*). The tagline carries both: "Daži jautājumi. 3 ieteikumi. Pērc uzreiz vai pieprasi labāku cenu."

**Structure: few campaigns, broad audience, many different creatives.** Since Meta's Andromeda change, the ad system picks *who* to show an ad to largely from the creative itself; splitting people into many ad sets mostly splits the learning. So: one main campaign, one ad set, 8–10 genuinely different ads, plus a small test campaign later.

### Phase 1 · weeks 1–2: "Iepazīsti Trilio" (learn who responds)

- **Objective: Traffic → Optimise for Landing page views** (needs the Pixel; a landing page view means the page actually loaded, not just a tap).
- Why not Leads yet: Meta wants roughly 50 optimisation events a week per ad set to leave the learning phase. A new brand in Latvia will not have 50 requests a week from ads on day one; optimising for a rare event with no history wastes the first budget.
- **Budget:** 15–20 € a day on the campaign (Advantage campaign budget), about 250 € for the two weeks. Latvian CPMs are usually low compared with Western Europe, but this is a guess until we see our own numbers.

### Phase 2 · from week 3: "Pieprasi labāku cenu" (optimise for requests)

- Switch when the Phase 1 campaign plus organic traffic gives **about 25–50 `Lead` events a week** (Meta counts all sources for learning).
- **Objective: Leads → Conversion location Website → Conversion event `Lead`.**
- Keep the Phase 1 ads that brought the cheapest *requests* (not the cheapest clicks); add 3–4 new concepts.
- Budget: same or +20 % every few days if cost per request holds; never double at once (it restarts learning).

### Phase 3 · from week 4: a small "come back" ad set (optional)

- Audience: website visitors of the last 30 days (only those who accepted cookies) + people who engaged with the page or Instagram in 90 days; exclude people who already requested.
- Message: only the request ("Patika kāds variants? Var pieprasīt labāku cenu.").
- 3–5 € a day. In Latvia with consent-gated tracking this audience will be small; if Meta says "audience too small", skip it: the main campaign already shows ads to warm people.

## 4. Audience and placements

- **Location:** Latvia, "People living in this location". **Age:** 25–65+ as a suggestion, Advantage+ audience on (Meta may go outside it when it finds responders). No interests, no lookalikes to start.
- **Language:** no language targeting; the creatives are Latvian and select their own audience. A Russian-language version would reach about a third of Latvia more, but the site has no Russian, so not now.
- **Placements:** Advantage+ placements. Give every ad three shapes: **9:16** (Reels, Stories), **4:5** (Feed), **1:1** (right column, some Feeds); otherwise Meta crops.
- **Special ad category:** none (appliances are not credit, housing, employment or politics).

## 5. Creatives (8 to start)

Rules for all: Latvian; the first 2 seconds / first line say the point; captions burned into every video (most watch muted); no "lētākais", no percentages, no countdowns or "tikai šodien"; an offer is always conditional ("ja varēsim lētāk"); no pronoun of address in ad text (BRAND.md); a price shown is a real, current price. Every line below passes the honesty lint (`lintPost`; headlines also `lintAdText`); the 90-character limit in `lintAdText` is Google's, Meta shows the first ~125 characters of primary text before "… vairāk", so the point goes first.

| # | Concept | Format | Lands on |
|---|---|---|---|
| R1 | "Pajautā" — the button and what happens after (TIKTOK_PLAN C1) | Reel 9:16, 15–20 s | a category flow (dish) |
| R2 | "Trīs jautājumi" — screen recording of the flow to three picks (C2) | Reel 9:16, 20 s | the same category |
| R3 | "Esam jauni" — owner to camera: who we are, ranking not bought (C3) | Reel 9:16, 20 s | home |
| R4 | "Pārdevējs" — the "tikai šodien" joke, then the honest way (C4) | Reel 9:16, 15 s | a category flow (fridge) |
| R5 | "Piedāvājums" — a real offer e-mail (C5); **only once a real offer exists** | Reel 9:16, 18 s | home |
| S1 | Tagline card: "Daži jautājumi. 3 ieteikumi. Pērc uzreiz vai pieprasi labāku cenu." | Image 4:5 + 9:16 | home |
| S2 | "3 ieteikumi: veļas mašīnas" with today's prices (from Admin → Sociālie tīkli, square slides) | Carousel 1:1, 4 cards, each its own link | washer flow |
| S3 | The best-performing **organic link post** of the month, used as an ad ("Use existing post"): it keeps its likes and comments | Existing post | its own link |

Videos can be made on a phone; real hands, real screen, real kitchen beat polished animation on Reels. Screen recordings at 1080 × 1920.

**Ad text (variants; Meta rotates them):**

- Primary 1: "Daži jautājumi, un trīs piemērotākie varianti no Latvijas veikaliem. Patīk kāds? Var pirkt uzreiz vai pieprasīt labāku cenu: pajautāsim izplatītājam."
- Primary 2: "Cenu var pajautāt. Pie katra ieteikuma ir poga „Pieprasīt labāku cenu”. Ja varēsim piedāvāt lētāk, atsūtīsim piedāvājumu; ja ne, paziņosim, kad cena veikalos kritīs."
- Primary 3: "Secību nenosaka veikalu komisija. Trilio rāda, kas der, un palīdz pajautāt labāku cenu. Padoms bez maksas."
- Headline: "Daži jautājumi. 3 ieteikumi." / "Pieprasi labāku cenu" / "Sadzīves tehnika bez minēšanas"
- Description: "trilio.lv · padoms bez maksas"
- Button: **Uzzināt vairāk** (Learn more).

**URL parameters** (Ad → Tracking → URL parameters, same on every ad):
`utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}`
The site already stores `utm_*` landings without cookies (Admin → Statistika), so requests can be traced to the ad even for visitors who declined cookies (counted, not identified).

## 6. Set-up in Ads Manager, step by step (Phase 1)

1. adsmanager.facebook.com → choose the Trilio ad account → **+ Create**.
2. Objective **Traffic** → Continue. Campaign name `LV | Traffic | Iepazīsti Trilio | 2026-11`.
3. Campaign: **Advantage campaign budget** on, **Daily 20 €**. Bid strategy **Highest volume**. A/B test off.
4. Ad set name `LV | broad | 25-65`. Conversion location **Website**. Performance goal **Maximise number of landing page views**. Dataset: Trilio.
5. Schedule: start tomorrow 07:00 (no end date; we stop by hand).
6. Audience: **Advantage+ audience** on; location **Latvia**; minimum age 18 (control), suggestion age 25–65+. No detailed targeting.
7. Placements: **Advantage+ placements**.
8. Ad: identity Facebook page **Trilio**, Instagram **trilio.lv account**. Format: Single image or video (for S2 choose Carousel; for S3 "Use existing post").
9. Upload the 9:16, 4:5 and 1:1 versions in the same ad (Meta places each). Turn **off** Advantage+ creative enhancements that change the content (text improvements, music, "add overlays", image expansion/generation); keep "Standard enhancements" only if the preview still says what we wrote. Generated text could break the honesty rules.
10. Primary text, headline, description, button as in §5; Website URL = the landing page; URL parameters as in §5.
11. Tracking: Website events → dataset Trilio (on).
12. Name each ad by concept (`R1 Pajautā`, `S2 Carousel veļas`) so `utm_content` is readable.
13. **Publish.** Meta reviews ads in minutes to a day.

Phase 2: duplicate the campaign → change objective to **Leads** → conversion location Website → event **Lead** → keep the ads that brought requests → publish; pause the Phase 1 campaign a day later.

## 7. Running it: what to look at and when

- **Days 1–7:** do not edit (each edit can restart learning). Look once a day only for disapprovals or a broken link.
- **Health checks (Phase 1):** link CTR ≥ 1 %, landing page view / link click ≥ 70 % (lower means a slow page or accidental taps), frequency < 2,5 a week.
- **Real check (both phases):** requests per 100 landing page views (Admin notify funnel by `utm_source=meta`). Hypothesis to test, not a promise: 1–3 requests per 100 visits.
- **After 7 days:** pause an ad that spent about 2 × the target cost per request with no request; keep the rest. Add 2–3 genuinely new concepts every two weeks (a new angle or person, not a new colour).
- **Weekly:** cost per request, confirmed requests (`notify_confirmed`), and how many requests the team could answer with an offer. If requests come but offers are rare, the ads are fine and the sourcing is the bottleneck; tell me and we change the promise's emphasis, not the budget.

## 8. Rules that stay

- Honest persuasion only (PRODUCT_SPEC, BRAND.md): no decoys, fake scarcity, countdowns, "lētākais", percentages, or unconditional promises of a cheaper price.
- Shop names come from data; an ad never names a partner shop as cheaper than another.
- Ads are public in Meta's Ad Library (EU DSA); write every ad as if a competitor and a journalist read it.
- No targeting of under-18s; no sensitive interests.

## 9. Next steps

| Who | What |
|---|---|
| Owner | Business portfolio, ad account (EUR, Europe/Riga), payment; verify `trilio.lv`; create the dataset and send **Dataset ID** + **CAPI token** |
| Claude | Meta Pixel + Conversions API behind the consent banner, `Lead` on a registered request, privacy and cookie text, tests; then the 4:5 / 9:16 / 1:1 versions of S1 and S2 from the existing image templates |
| Owner | Film R1–R4 on a phone (scripts in docs/TIKTOK_PLAN.md §6); R5 when a real offer exists |
| Both | Launch Phase 1; review on day 7 and day 14; switch to Phase 2 when requests allow |

## Sources

Third-party summaries of Meta's 2025–2026 changes (treat numbers as rough; Meta publishes few):
[Chatterbuzz — Meta Andromeda guide](https://www.chatterbuzzmedia.com/blog/meta-andromeda-creative-targeting/) ·
[Jetfuel — Meta 2026 algorithm update](https://jetfuel.agency/metas-2026-algorithm-update-what-andromeda-changed-and-how-to-adapt-your-ads/) ·
[Pixelflow — Meta ads checklist 2026](https://pixelflow.so/blog/meta-ads-checklist-2026) ·
[Nowoka — Advantage+, Andromeda and creative](https://nowoka.com/blog/meta-ads-andromeda-advantage-plus-guide-2026/) ·
[Flexyconsent — Pixel and CAPI consent in the EU](https://flexyconsent.com/blog/meta-pixel-facebook-conversions-api-consent-guide/) ·
[Piotr Litwa — Conversions API setup 2026](https://piotrlitwa.com/articles/en/meta-conversions-api-setup-guide.html)
