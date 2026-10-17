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
   sku), price, stock and condition. Used items are rejected. Refurbished
   items go to the refurbished block, as with feeds.
5. Pages never seen before are read first, then the ones unseen longest, so
   a run capped at `maxPages` rotates through a large catalogue.

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
| tet.lv | Yes | Yes, about 12 300 URLs | schema.org Product: name, sku, price, stock | Yes, in `data-ean` | Scrapeable after a small parser addition |
| depo.lv (online.depo.lv) | Yes | No | None in HTML, JavaScript app | No | Needs a feed |
| ikea.com/lv | Yes | Yes | schema.org Product: name, price, stock | No, IKEA article numbers only | Own-brand products only, nothing to compare across shops |
| 1a.lv | No, Cloudflare block | n/a | n/a | n/a | Needs a feed or allow-listing |
| euronics.lv | Yes | Yes | schema.org Product | Yes | Scraped |
| m79.lv | Yes | Yes, gzipped | schema.org Product | Yes | Scraped |
| bigbox.lv | Yes | No sitemap | schema.org Product: name, price, stock | Yes | Needs link discovery from category pages |
| neoshop.lv | No, JavaScript challenge | n/a | n/a | n/a | Needs a feed or allow-listing |
| dateks.lv | No, Cloudflare challenge | n/a | n/a | n/a | Needs a feed or allow-listing |
| lmt.lv, bite.lv | No, Cloudflare challenge | n/a | n/a | n/a | Telecom shops, mostly phones |
| elkor.lv | No, redirect loop to elkor.com | n/a | n/a | n/a | Not reachable |
| discover.lv | Yes | No | None | No | Needs a feed |
| photopoint.lv | Redirects to photopoint.ee | n/a | n/a | n/a | No Latvian shop |

1a.lv and ksenukai.lv both belong to Kesko Senukai, so one agreement covers
two of the largest appliance sellers.

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
3. Add the store to `src/db/stores.ts`, run `npm run db:seed`, then try a few
   pages: `npm run ingest -- <slug>` and check `rowsRejected` and the
   rejected sample.

## Legal note

Prices and product data on public pages are generally fine to read, but a
shop's terms of use and the EU database right can limit systematic copying
of a large part of its catalogue. These shops are meant to be affiliate
partners, so the safest path is to tell each one that `TrilioBot` reads its
appliance pages at this pace, and to switch to a feed when they offer one.
