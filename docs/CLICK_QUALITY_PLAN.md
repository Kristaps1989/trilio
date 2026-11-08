# Click quality and the brand search

Owner's ask (7 Nov 2026): every day there are shop clicks (all to one shop,
all from Chrome on Windows, all labelled „Kartītes „Pirkt” (jautājums jau
atbildēts)”) and none of those visitors has seen the question before the shop
(„Iegūt lētāk”). The answer should expire after 24 hours, so this looks like a
bot. Make a professional audit, also of SEO, so that a search for "Trilio"
finds trilio.lv above trilio.io. Then: implement all, run e2e.

Status: **built (7 Nov 2026).**

## 1. What the audit found

- The card's „Pirkt” button is a real link `/go/<offer>?from=card`. The question
  sheet only exists once the results page's JavaScript has run and found no
  answer. So `from=card` without `ask_shown` was produced by four different
  things: a client that never runs JavaScript (scraper, link checker, a mail or
  chat "safe links" scanner with a Chrome user agent; the bot filter only knows
  agents that say they are bots), a click before hydration, a browser with
  blocked storage (`answered()` returned true when `localStorage` threw), and,
  correctly, an answer from the last 24 hours.
- On 7 Nov: 17 results renders, but only 3 results pages actually shown by a
  browser running JavaScript; 16 kettle searches with the same single answer;
  8 clicks, one shop, a 47 % click rate. A script repeating one results URL and
  following its first shop link, plus a few real visitors.
- `search_sessions` got a new row on every render of `/rezultati` (filter change,
  reload, back/forward), so „Meklējumi” and „Rezultātu skatījumi” counted renders.
- A click row kept no request metadata, so a person and a script could not be told apart.
- SEO: the technical basics are in order (redirects, title, canonical, hreflang,
  robots, sitemap, favicon). What a name search lacks is entity signals: who
  Trilio is, where, and its profiles elsewhere.

## 2. The question before the shop is asked on the server too

- `/go/<offer>?from=card` without a `trilio_ask` cookie from the last 24 hours
  redirects to **`/pirms-veikala/<offer>?s=…`** instead of the shop, and records
  no click. The page shows the same two choices as the sheet (`AskChoices`,
  shared with `ShopLink`), is `noindex` and closed in robots.txt.
- „Uz {Shop}” (`from=ask`) goes to the shop and sets the cookie on the redirect,
  so the answer holds even where the page's own script cannot store it.
- The answer moved from `localStorage` to the first-party functional cookie
  `trilio_ask` (24 hours, listed on /sikdatnes; it stores a choice the shopper
  made, so no consent is needed). Blocked cookies: the question is asked again.
- A product already requested links with `from=saved`, which never asks.
- Known bots still go straight to the shop and are counted only as bots.
- The question page counts `ask_shown` on the server for a person (not a bot,
  not suspect, not an admin), as the sheet does on the client.

From 7 Nov a `from=card` click means what its label says: the question was answered within a day.

## 3. One search session per visitor and search

`searchSessionFor` reuses the session of the same visitor (the day's anonymous
hash), category and answers within 30 minutes; `search_sessions.visitor_hash`
is new. „Meklējumi” and „Rezultātu skatījumi” count searches, not renders.

## 4. Person or script: every click is checked

`affiliate_clicks` keeps `signals` (Sec-Fetch-Site, -Mode, -User, the referrer's
host only, the first language) and `suspect`, the first matching reason
(`src/domain/analytics/click-quality.ts`):

| Reason | Rule |
| --- | --- |
| `no_fetch_meta` | A user agent of a browser that always sends Sec-Fetch-* (Chromium 80+, Firefox 90+, Safari 16.4+) arrived without them. |
| `not_from_page` | A link that only exists inside a Trilio page arrived as `cross-site` or `none`. |
| `no_page_view` | The same visitor hash sent no page view that day (the page beacon needs JavaScript and a visible page). |

Suspect clicks still reach the shop (nothing visible changes) but are left out
of every figure: Statistika's shop clicks, the confidence block, ads and TV
attribution, social "most clicked". Statistika → **„Klikšķu kvalitāte”** shows
people and the suspect clicks per reason, with `data-click-quality="people/suspect"`.
Clicks before 7 Nov carry no signals and are counted as before.

## 5. The brand search

- The site's JSON-LD (`src/app/[locale]/site-jsonld.ts`): the Organization gets
  `@id`, `alternateName` (the domain), `legalName`, `vatID` and address from
  `COMPANY_*`, `email`, `contactPoint`, `areaServed: Latvia`, `knowsLanguage`
  and **`sameAs`** from `BRAND_PROFILES` (https addresses, comma separated: the
  Facebook page, Instagram, LinkedIn, the Lursoft/firmas.lv entry). The WebSite
  gets `alternateName` and `publisher`.
- **/par-trilio** („Par Trilio”, English /en/par-trilio): what Trilio is, how it
  chooses, the company, and that it is not affiliated with companies of the same
  name elsewhere. AboutPage JSON-LD; linked from every footer and the home page;
  in the sitemap.
- Bing Webmaster Tools: `BING_SITE_VERIFICATION` adds the `msvalidate.01` tag.

For the owner after the deploy:

1. Set `BRAND_PROFILES` and `COMPANY_NAME` (and the other `COMPANY_*`) on Railway.
2. Put `https://trilio.lv` in the website field of the Facebook page, Instagram,
   LinkedIn and the register entry.
3. Bing Webmaster Tools → import from Search Console, or set `BING_SITE_VERIFICATION`.
4. Search Console → URL inspection → `/par-trilio` → Request indexing; resubmit the sitemap.
5. The Google Ads brand campaign: raise the max CPC on `[trilio]` / `[trilio.lv]`
   until the diagnosis says it shows; keep trilio.io's product words as negatives.
6. Ask Go3 to link trilio.lv from the published case study.
7. Measure in Search Console: query contains "trilio", country Latvia, position.

## 6. A script's whole day is left out, not only its clicks (owner, 8 Nov 2026)

The owner saw 19 shop clicks in a day, all flagged, with 19 kettle searches all
answered "steel" and 19 „Izvēlējās veikalu” with no question ever shown: a
link-following script with a browser's name. Its clicks were left out, but its
searches and funnel steps were not. Now every request a visitor makes is judged
the same way (`requestSuspicion` in `domain/analytics/click-quality.ts`,
`judgeRequest` in `services/visits/judge.ts`):

- **Marked where it is stored:** the page view beacon (`visits.suspect`, also
  "not_from_page" when a beacon comes from another site), the results page
  (`search_sessions.suspect`), the funnel's server calls and the `from=ask`
  shop link (`ui_events.suspect`), besides the click itself. An admin's own
  page views, searches and steps are marked "internal".
- **Left out by visitor day:** a visitor (the day's anonymous hash) with any
  request without fetch metadata, or an admin's own, is left out of that day's
  visitors, views, searches, the funnel, the browser table and the TV sessions,
  baseline and household visits (`services/visits/suspects.ts`). A click judged
  only "not from a page" or "no page view" does not taint the day: a person can
  open a saved link from an e-mail. Rolled-up days still in the raw visits
  (35 days) are rebuilt in full every night, so the last five weeks clean up by
  themselves.
- **Who it is:** Statistika → Klikšķu kvalitāte lists the suspect clicks by
  reason, browser family (stored per click from 9 Nov), link, shop and category,
  with the number of distinct visitors, the first and last time and the
  referrer host and language; the bots tile shows the left-out visitor days
  (scripts, admins).
- **TV:** "Pārrēķināt bāzi" draws the campaign's baseline again without the
  left-out days while their raw visits are still kept, and recomputes the
  stored uplift days with it.

What the script did not touch: visitors and the TV sessions count a page only
when its JavaScript ran and the page was visible for a second, and a client
without fetch metadata does not run JavaScript; so 8 Nov's 85 visitors were
not this script. The new marks make sure of it for any script that does.

## 7. Tests

- Unit: `click-quality.test.ts` (signals, modern browsers, each reason, the
  cookie), `site-jsonld.test.ts` (profiles, structured data).
- DB: `visits.test.ts` (suspect reasons stored, left out of shop and source
  figures; search session reuse per visitor, search and 30 minutes).
- e2e `clicks.spec.ts`: without JavaScript a card link opens the question page,
  „Uz {Shop}” reaches the shop and sets the cookie, the next card link goes
  straight through; the page with JavaScript (request, axe, 404); a script with
  a Chrome user agent counted as suspect in Statistika; „Par Trilio”, JSON-LD,
  sitemap, robots. `flow.spec.ts` follows the new redirect; `a11y.spec.ts` covers /par-trilio.
