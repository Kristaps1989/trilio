# Product pictures, EPREL energy badge and cheaper attribute extraction

Plan of 21 Oct 2026 (owner asked for pictures and lower Claude API cost; the model is now an environment variable).

## 1. Product photos

**Where.** Result cards (picks, extras, "Citi varianti", refurbished), the model check page and saved products in the wishlist. Not in the question cards: the owner decision of 18 Oct ("pictures used wisely") keeps the to-scale line drawings there.

**Source.** `products.image_url`, already filled by every feed and crawl (JSON-LD `image`, feed `image_link`). EPREL has no product photos. All shops' photos are shown, as thumbnails that sit next to a link to the shop (recommendation given to the owner on 21 Oct; partner feeds are meant for display, crawled shops' photos are shown the way comparison sites do).

**How.**
- `next/image` through our own `/_next/image` optimiser: resized for a 360 px phone, and the shopper's browser never contacts a shop's server. `images.remotePatterns` is built from `imageHosts` in `src/db/stores.ts`, the same list the stores table holds, so adding a shop stays a configuration change.
- `src/domain/catalog/media.ts` (pure): `imageSrc(url, hosts)` accepts only https URLs on an allowed host (anything else would make `next/image` throw), plus local `/sample/` files used by the design sample data.
- `ProductImage` (client component): the photo on a white tile (cards are white already; on the dark wishlist the tile keeps shop photos with white backgrounds looking deliberate). Missing, disallowed or broken photo (`onError`) → the subcategory's line drawing, so a card never has a hole.
- Alt text is the product name. Fixed box sizes, so nothing shifts while loading.

## 2. EPREL energy badge

- The EPREL job stores `products.eprel_id = "<group>/<registration>"` when it finds a record.
- Cards for such products show the EU class arrow (A–G in the label's colours) with two links: the official label (PNG) and the product information sheet in Latvian (PDF), both from `eprel.ec.europa.eu`. EU labelling rules expect exactly this beside a price online.
- Products without an EPREL match show nothing new (the shop-stated class stays in the specs line).

## 3. Attribute extraction costs (Claude API)

Measured on 19–21 Oct: about $16 in three days, all from attribute extraction on Opus as thousands of new products arrived.

1. **Skip products with no gaps.** When the spec table, feed, rules or EPREL already filled every extractable key, the product is marked done without a call (`extraction_model = "not-needed"`).
2. **Ask only for what is missing.** The user prompt names the missing keys; fewer output tokens.
3. **EPREL first.** Products in the energy-label categories wait up to 3 days for their EPREL lookup, which fills most keys for free.
4. **Grouped by subcategory.** Products are processed in subcategory order, so the cached system prompt (per subcategory) is reused instead of rewritten.
5. **Cheaper defaults.** `LLM_MODEL` default `claude-haiku-5-5` (the owner's Railway variable overrides it); `LLM_DAILY_CALL_CAP` default 300.
6. **Daily usage line.** After each run with extraction: `llm today: {calls, failed, inputTokens, outputTokens, cacheReadTokens, estimatedUsd}` per model, in the Railway log of whichever service ran it.

## 4. Tests

- Unit: `media.ts` (host matching, https only, sample paths, EPREL links), extraction skip/missing-keys/EPREL wait/order, usage summary and cost estimate, EPREL job writes `eprel_id`.
- E2E (360 px and desktop): result cards show photos with the product name as alt and a loaded image; a product without a photo shows the drawing; the model page shows the EPREL badge with label and sheet links for a real EPREL product in the sample data; the wishlist shows the saved product's photo; axe passes.
