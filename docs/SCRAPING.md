# Reading shops without a feed (scraping)

Partner shops that do not send a product feed are read from their public
product pages. The crawler lives in `src/services/ingestion/scrape/` and runs
as `feed_type = 'scrape'` inside the normal ingestion pipeline, so EAN
matching, price history, the 30-day low and the radar all work the same way.

## How it works

1. **robots.txt** is fetched first. Pages it disallows for `TrilioBot` (or
   for `*` when it names no group for us) are never requested. A
   `Crawl-delay` longer than our own delay wins.
2. **Sitemaps** listed in `stores.scrape_config.sitemaps` are read,
   following sitemap indexes on the same host. Gzipped sitemaps are inflated
   with a size cap.
3. **Product URLs** are kept only when their path matches `include` (and not
   `exclude`). The category comes from the URL via `categoryFromUrl`, and
   `stores.category_map` turns it into our subcategory id. Unmapped categories
   are rejected; there is no free-text guess, so accessories and spare parts
   stay out.
4. **Product pages** are read one at a time, with `delayMs` (at least one
   second) between requests. The schema.org `Product` data in the page's
   JSON-LD gives name, brand, EAN (gtin13 and variants), model code (mpn or
   sku), price, stock and condition. When the JSON-LD has no EAN, a single
   agreeing `data-ean`, `data-product-ean` or `data-flix-ean` attribute on a
   one-product page is used instead. Used items are rejected. Refurbished
   items go to the refurbished block, as with feeds.
5. **The spec table** of a one-product page is read too (see below). It
   becomes the product's typed attributes, and the raw table is stored in
   `products.spec_table`.
6. **Sanity check.** Each row is checked against the subcategory before it is
   saved, so mis-filed products and accessories are rejected (see below).
7. Pages never seen before are read first, then the ones unseen longest, so
   a run capped at `maxPages` rotates through a large catalogue. Pages read
   before spec tables were stored also count as never seen, so they are
   re-read first.

## Spec tables

JSON-LD has no dimensions, volume, type or energy class. The shop's
specification table does, so `extractSpecTable` in
`src/services/ingestion/specs/table.ts` reads it as label → value pairs:

| Shop | Markup |
|---|---|
| euronics.lv | `<span class="specification__title">` + `<span class="specification__value">` |
| tet.lv | `i-specs-table__label-text` + `i-specs-table__value-el` (across tooltip markup) |
| m79.lv | `<div class="spec_line">Label: <span class="value">…</span></div>` |
| any shop | `<th>`/`<td>` rows and `<dt>`/`<dd>` pairs |
| fallback | "Label: value, Label: value" in the meta description (tet.lv and m79.lv put key specs there) |

Labels are normalised: lower case, single spaces, no trailing colon. The
first value for a repeated label wins, because shops repeat key specs in
summaries. Labels over 80 characters and values over 300 are skipped. m79.lv
names such as "… | Dziļums 54 cm | Mazgāšanas ietilpība 7kg" are read as
label/value pairs as well.

The labels are mapped to our attributes by `data/attributes.json`, not by
per-shop code. A new shop label is usually a one-line data change. See
`docs/ATTRIBUTES.md` for the mapping, units, source priority and how values
from several shops are merged by EAN. Saved real pages for the parser tests
are in `src/services/ingestion/specs/__fixtures__/pages.json`.

## Rejected rows

Every rejected row is counted in the run's `rowsRejected`, and up to 20
appear in `rejectedSample` with their reason:

| Reason | Meaning |
|---|---|
| `unmapped_category` | The shop category is not in `stores.category_map`. |
| `price`, `availability`, `condition` | Missing or unreadable price, stock or condition. Used items are rejected too. |
| `no_identity` | Neither an EAN nor a model code. |
| `accessory` | The name matches a spare-part or accessory pattern (filters, bags, shelves …). |
| `category_mismatch` | Nothing in the name, description or spec table shows the product belongs to the subcategory. The shop's category label alone is not trusted: m79.lv lists toys under coffee machines. A spec table that states a category-specific attribute, such as a dehydrator's trays, also counts as proof. |
| `implausible_price` | The price is outside the subcategory's plausible range. |

The word stems, accessory patterns and price ranges are data in
`data/attributes.json` (`docs/ATTRIBUTES.md`, "Sanity rules").

## Politeness and limits

- One request at a time, from one process, with an honest User-Agent:
  `Mozilla/5.0 (compatible; TrilioBot/1.0; +APP_URL)`.
- HTTP 401, 403, 429 or 503 stops the store's run at once. Pages already
  read are kept.
- A bot challenge (Cloudflare, JavaScript cookie redirect, captcha) stops
  the run. **We do not work around a shop's bot protection.** Such a shop
  needs a feed, or an agreement to allow-list `TrilioBot`.
- Five fetch errors in a row, or `maxRunMinutes`, also end the run.
- The same SSRF guards as feeds apply: HTTPS only, the shop's own host,
  no private addresses, bounded redirects and body sizes.

## Stock and staleness

A run that read every discovered page marks offers unseen for 24 hours as
out of stock, like a feed. A partial run (capped, rotated or stopped early)
waits `staleAfterHours` (default 7 days) instead, which must be longer than
one full rotation.

## Latvian shops surveyed (October 2026)

Traffic order follows Semrush's Latvian retail ranking for August 2026 where
the shop appears in it. 220.lv is left out on purpose. Marketplaces,
classifieds and price aggregators are not data sources (see the legal note).
Each shop got a handful of requests as `TrilioBot`: home page, robots.txt,
one sitemap, one product page.

| Shop | Reachable by our crawler | Sitemap | Product data on the page | EAN | Status |
|---|---|---|---|---|---|
| rdveikals.lv | No, Cloudflare challenge | n/a | n/a | n/a | Needs a feed or allow-listing |
| ksenukai.lv | No, Cloudflare challenge | n/a | schema.org Product: name, brand, price, stock, energy class, rating (from a page saved in a browser) | Yes, in `data-flix-ean` | Needs a feed or allow-listing |
| tet.lv | Yes | Yes, about 12 300 URLs | schema.org Product: name, mpn, price, stock | Yes, in `data-ean` | Scraped, about 2 900 appliance and personal-care pages |
| depo.lv (online.depo.lv) | Yes | No | None in HTML, JavaScript app | No | Needs a feed |
| ikea.com/lv | Yes | Yes | schema.org Product: name, price, stock | No, IKEA article numbers only | Own-brand products only, nothing to compare across shops |
| 1a.lv | No, Cloudflare block | n/a | n/a | n/a | Needs a feed or allow-listing |
| euronics.lv | Yes | Yes | schema.org Product | Yes | Scraped |
| m79.lv | Yes | Yes, gzipped | schema.org Product | Yes | Scraped |
| bigbox.lv | Yes | Empty sitemap, listings load from a private API | schema.org Product: name, price, stock | Yes | Needs a feed (inactive store row is ready) |
| neoshop.lv | No, JavaScript challenge | n/a | n/a | n/a | Needs a feed or allow-listing |
| dateks.lv | No, Cloudflare challenge | n/a | n/a | n/a | Needs a feed or allow-listing |
| lmt.lv, bite.lv | No, Cloudflare challenge | n/a | n/a | n/a | Telecom shops, mostly phones |
| elkor.lv | No, redirect loop to elkor.com | n/a | n/a | n/a | Not reachable |
| discover.lv | Yes | No | None | No | Needs a feed |
| photopoint.lv | Redirects to photopoint.ee | n/a | n/a | n/a | No Latvian shop |

Personal care (shavers, trimmers, hair dryers, stylers, electric toothbrushes,
epilators) was added on 19 Oct 2026. The shop sections were measured on the
live sitemaps: tet.lv `/veikals/skuvekli/` and nine more category slugs,
euronics.lv `skaistums-un-veseliba/…` (16 more product sitemaps), and m79.lv
categories such as "Viriesu skuvekli" and "Matu ieveidotaji". The maps live
in `src/db/stores.ts`. m79.lv names are often only a model code, so some of
its personal-care pages fail the sanity check unless their description or
spec table says what they are.

1a.lv and ksenukai.lv both belong to Kesko Senukai, so one agreement covers
two of the largest appliance sellers.

bigbox.lv shows full product data with EAN on each product page, but its
sitemap is empty and category listings are loaded from a private GraphQL API
that needs a session handshake. The site also serves pre-rendered pages to a
list of search-engine bots. Using the private API or posing as one of those
bots is outside what this crawler does, so bigbox.lv needs a product feed.

## Configuration reference

`stores.scrape_config` (validated by `ScrapeConfigSchema` in `crawler.ts`):

| Key | Default | Meaning |
|---|---|---|
| `sitemaps` | required | Sitemap or sitemap-index URLs on the shop's host. |
| `include` | required | Regex sources, case-insensitive, matched against the URL path. |
| `exclude` | `[]` | Regex sources that drop a URL. |
| `categoryFromUrl` | none | Regex with one capture group, run on the decoded path. Without it the JSON-LD `category` is used. |
| `maxPages` | 2000 | Product pages per run. |
| `delayMs` | 1500 | Pause before each request, at least 1000. |
| `maxSitemaps` | 300 | Sitemaps read per run. |
| `maxRunMinutes` | 90 | Time budget per store per run. |
| `staleAfterHours` | 168 | Unseen window for partial runs, see above. |

The euronics.lv and m79.lv values are in `src/db/stores.ts` and are written
by `npm run db:seed`.

## Adding a shop

1. Check `https://shop/robots.txt` and the sitemap it names. Open a product
   page and confirm there is a `<script type="application/ld+json">` with a
   `Product` that has an EAN and an offer price in EUR.
2. Find which URL path segment carries the category, and write `include`,
   `categoryFromUrl` and `category_map` for the categories we handle.
3. Check that its spec table is read: save a product page and run it through
   `extractSpecTable`. If the shop uses new markup, add a pattern and a
   fixture. Add any labels we do not know yet to `data/attributes.json`.
4. Add the store to `src/db/stores.ts`, run `npm run db:seed`, then try a few
   pages: `npm run ingest -- <slug>` and check `rowsRejected` and the
   rejected sample. A high `category_mismatch` count usually means a missing
   word stem or spec label. Then check `/api/status` coverage for the
   categories the shop sells.

## Legal note

Prices and product data on public pages are generally fine to read, but a
shop's terms of use and the EU database right can limit systematic copying
of a large part of its catalogue. These shops are meant to be affiliate
partners, so the safest path is to tell each one that `TrilioBot` reads its
appliance pages at this pace, and to switch to a feed when they offer one.
