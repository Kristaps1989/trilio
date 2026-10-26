# Indexing plan: the Search Console report of 19 Oct 2026

Owner's request, 26 Oct 2026: Google sent an e-mail about "critical issues" in Page indexing. Review and plan the fixes.

Status: **plan, awaiting the owner's go.**

## 1. What the report says

| Reason | Pages | Verdict |
|---|---|---|
| Indexed | 164 | Good: 164 of 346 sitemap addresses, eight days after the sitemap was first read. |
| Blocked by robots.txt | 68 | **Intended.** No fix. |
| Page with redirect | 1 | **Harmless.** No fix. |
| Crawled – currently not indexed | 35 | **The real issue.** Google read these pages and decided they add nothing over pages it already has. |

Google's e-mail calls all three "critical" because that is its template for any "not indexed" row. Only the third one costs visitors.

### Blocked by robots.txt (68)

These are the addresses Trilio closes on purpose: the shop click-through links `/go/<offer>` (one per product card, 163 distinct ones on the landing pages today), the wishlist and the sign-in page. They carry no content for a search engine, and the `/go/` links already say `rel="sponsored"`, as Google asks for affiliate links. The number will grow towards about 170 as Google finds the rest. That is the report working as designed, not a problem.

### Page with redirect (1)

One address Google found redirects: `http://`, `www.`, `/lv/…` or the old `/radars` link. All of them redirect correctly to the final page. Nothing to change.

### Crawled – currently not indexed (35)

The sitemap lists four landing pages per category: the base page and three budget pages (`/kategorija/fridge`, `/lidz-500`, `/lidz-800`, `/lidz-1200`), in Latvian and English. I rendered all 156 Latvian ones on 26 Oct and compared the three picks:

| Finding | Pages |
|---|---|
| Budget page with exactly the base page's picks | 63 |
| Budget page with exactly another budget page's picks | 35 |
| Page with fewer than three picks | 59 |
| Page with no picks at all (`chopper/lidz-25`, `airfryer/lidz-80` had one) | 2 |

Under the rule "a budget page earns its own address only when it shows three products and a different set from the base page and every lower budget", **34 of the 117 budget pages stay**; 83 are duplicates of a page that already exists. Google reached the same conclusion for the 35 it looked at closest; the rest would follow.

A second finding on the same pages: 73 product cards carry a name that says nothing to a reader or a search engine: a bare model code ("AF1409DW", "MMB6141W"), a brand alone ("Caso"), a feed name in Polish with broken characters ("Xiaomi Portable Blender EU biaÅ‚y"), or a shop's marketing line ("AirFryer. Ēdiena gatavošana EDUKAMP fritieri"). The results page already builds "Brand + type + model" with `displayName`; the landing pages still use the plain `cleanName`.

## 2. The fixes

### A. One address per distinct set of picks (the main lever)

- A budget page is **distinct** when it has three picks and its set of products differs from the base page and from every lower budget step of the same category. Pure function in `src/domain/seo/landing-index.ts`, unit-tested.
- A budget page that is not distinct keeps rendering (its links and chips still work) but carries `rel="canonical"` to the nearest distinct page below it (the base page in most cases) and is left out of the sitemap. Google then folds it into that page instead of judging it thin.
- A base page with no picks gets `noindex` and is left out of the sitemap until stock returns; with one or two picks it stays indexed (it is still the best page for that category).
- The English pages follow the Latvian decision for the same category and budget, so hreflang pairs stay consistent.
- The sitemap already runs per request against the database; the decision is computed once an hour (`unstable_cache`) for all 39 categories and shared by the sitemap and the pages.
- Stability: picks change with prices, so a page can switch between distinct and folded. With the "at least one different product" rule that is rare, and a switch only moves the canonical, never breaks a link.

Expected sitemap after the change: 39 base + about 34 budget pages per language, roughly 165 addresses instead of 346, nearly all of them indexable.

### B. Names that say what the product is

- Landing cards and the JSON-LD `Product.name` use `displayName` (brand, type, model), as the results page does.
- `cleanName` learns two more cases: a name that is only the brand or only the model code is rebuilt as "Brand Model"; a mis-decoded UTF-8 feed string ("Å‚" for "ł") is repaired before the rest of the cleaning, so the Polish-lead rule then applies and rebuilds the name.
- Unit tests for the new cases in `naming.test.ts`.

### C. A paragraph that only this budget page can say

Each distinct budget page gets one deterministic sentence from the data under its title, so the page differs in text as well as in picks: how many models fit the budget, the price span of the three picks, and what the step above the lower budget adds (for example "Līdz 150 € pievienojas modeļi ar 5 l tilpumu un digitālu vadību"). Built from the picks' deciding attributes (`knowledge.json`), never from a model.

### D. Honest sitemap dates

`lastmod` is today's date on every landing page, every day. Google ignores dates that always change. It becomes the day the page's picks or their prices last changed, from the offers' `updatedAt`, and is omitted when unknown.

### E. Nothing to do in Search Console except wait

- "Blocked by robots.txt" and "Page with redirect": leave them. Do not press "Validate fix".
- "Crawled – currently not indexed" has no validation button; Google re-reads the pages on its own, typically within two to four weeks after the deploy. Resubmitting the sitemap in Search Console after the deploy speeds that up.
- Also worth doing now: in Search Console, set the property to receive e-mails only for errors, so the next "not indexed" count does not come as an alarm.

## 3. Tests

- Unit: the distinct-page rule (identical to base, identical to a lower step, fewer than three picks, order-insensitive), the name repairs.
- e2e (`tests/e2e/seo.spec.ts`): a folded budget page carries a canonical to its base page and is absent from the sitemap; a distinct one keeps its own canonical and is listed; an empty page is `noindex`; every product card on a landing page names the brand and the product type; the sitemap carries no `lastmod` of today unless prices changed today; hreflang pairs match for a folded page.

## 4. Delivery

One PR, about a day: domain rule and tests, landing pages and sitemap, names, the budget sentence, e2e, docs. Then resubmit the sitemap.

## 5. What this does not fix

The 59 pages with fewer than three picks are a catalogue question, not an SEO one: breadmakers, dehydrators, epilators, choppers and juicers have one or two products in stock across the partner shops. More partners or more feeds are the only cure; the pages stay honest about what is available.
