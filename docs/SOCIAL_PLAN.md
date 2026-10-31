# Automatic Facebook and Instagram posts (plan, 31 Oct 2026)

Owner's ask: posts should go out on the Trilio Facebook page and Instagram account without the owner having to think about them. Two conditions from the owner: no personal data of any shopper may appear, and the register is open (the site says "tu"; a business page may need "jūs").

## 1. What the posts are for

Trilio is unknown. The posts have one job: make the promise familiar so that the paid ads and the Google searches land on a page that looks alive and trustworthy. Each post is one true thing from Trilio's own data, said in the brand's words. No stock photos, no invented numbers, no "lifestyle" fluff. A post that cannot be backed by a row in the database is not written.

The measure is not likes. It is: visits from the posts (UTM), taps on "Pieprasīt labāku cenu" from those visits, and the follower count on both accounts as a slow background number.

## 2. Principles

1. **Truth from the data.** Every price, product name, drop and count in a post comes from a query made at posting time. A post is rendered and published in the same run, so a number can never be stale by more than minutes.
2. **The honesty lint applies** (`src/domain/ads/honesty.ts`): no superlatives, guarantees, percentages, urgency or discount words, no competitor names. Two rules are added for social: "bez maksas" may stand only next to a service word (padoms, pieprasījums, paziņojums), never next to tehnika or prece; and a post about an offer must say "ja" (if) wherever a future offer is implied.
3. **No personal data, ever.** §5 is the rule in full.
4. **One voice.** Register decided in §9 (D1). Buttons and CTAs are infinitives, as on the site.
5. **The owner can always stop it.** Approve mode first; automatic later; a kill switch at any time, as the ads have.

## 3. Post types

Six types rotate. Each has a data source, a rendered image from the brand template (`src/services/ads/creatives.tsx`, satori: night-green, lime, Space Grotesk, Figtree) and a caption in Latvian.

| # | Type | Source | Image | Caption shape | When |
| --- | --- | --- | --- | --- | --- |
| A | **3 ieteikumi** | The three picks for a subcategory with its default answers (the same `searchProposal` the wishlist uses), with today's shop prices | Three cards: name, price level or price, one deciding fact each | "Trīs ieteikumi: {kategorija} līdz {budžets}. {Fakts par izvēli}. Pērc veikalā vai pieprasi labāku cenu. → trilio.lv/{saite}" | Twice a week; a different subcategory each time, rotated by traffic |
| B | **Cena samazinājās** | A product whose price today is below its 30-day low by a real amount (Omnibus; `price_history`) | One card: product, today's price, the 30-day low, the shop | "{Prece} šodien {cena} veikalā {veikals}, zemāk nekā pēdējās 30 dienās ({zemākā}). Cenu vēsture un trīs alternatīvas → …" | Only when the data shows a drop of at least 5 %; at most twice a week |
| C | **Kā izvēlēties** | One deciding factor from `data/knowledge.json` for a subcategory | Quote card with the factor and one sentence | "Kas ir {faktors} un kad tas ir svarīgi: {viens teikums}. Visi {kategorija} ieteikumi → …" | Once a week |
| D | **Pieprasīts un atrasts** | A real offer that was **accepted and paid** (`special_offers`, `offer_orders`), anonymised per §5 | Card: product, shop price, Trilio's price, delivery days | "Pircējs pieprasīja labāku cenu {precei}. Veikalā {cena}, Trilio piedāvāja {cena}, piegāde {n} darba dienās. Ja varam lētāk, piedāvājam; ja ne, paziņojam, kad cena krīt. → …" | Only when one exists; at most once a week; never the same order twice |
| E | **Ko meklē šonedēļ** | The five subcategories with the most results views in the last 7 days (first-party `visits`, cookieless, aggregated) | Ranked list card: 1–5 with the category illustrations | "Ko Latvija meklēja šonedēļ: 1. {kat}, 2. {kat}, 3. {kat}… Katrai trīs ieteikumi → trilio.lv" | Once a week (Sunday 11:00), only when the top category has at least 50 views, so the list means something |
| F | **Visvairāk skatītās preces** | The three products with the most results-card views, shop clicks or saves in the last 7 days (`ui_events`, `visits`, `saved_items` counts, aggregated) | Three cards: product, today's price, the shop | "Nedēļas trīs visvairāk skatītās preces: {prece} ({cena}), {prece} ({cena}), {prece} ({cena}). Pērc veikalā vai pieprasi labāku cenu → …" | Every other week in the Friday slot when no type D exists; a product needs at least 30 views to qualify |

Reels are not generated: a person speaking and a real tap on a phone cannot be produced honestly by a template. The owner shoots those (docs/TIKTOK_PLAN.md C1–C5); the system schedules and publishes them once uploaded (type **R**, manual).

Facebook and Instagram get the same image and the same caption, with two differences: Facebook carries the link in the text; Instagram gets "saite profilā" and five hashtags from a fixed, lint-checked list (#sadzīvestehnika #trilio #ledusskapis …), since Instagram captions do not link.

## 4. Cadence and timing

- Three generated posts a week plus a Sunday list: Monday A, Wednesday C or B, Friday D, F or A, Sunday 11:00 E. B pre-empts Wednesday when a drop exists; D pre-empts Friday when a paid order exists, else F every other week, else A. E runs only when the week's traffic clears its threshold.
- Published at **19:00 Europe/Riga**, the evening peak for Latvian consumer pages; a Saturday 11:00 slot is added once reach data says it works.
- A post is drafted 24 hours before its slot, so the owner has a day to look at it in Approve mode.
- Reels (type R) go whenever uploaded, into the next free evening slot.

## 5. Personal data: the rule

Nothing that identifies a shopper leaves the database. In code this is a single `anonymise()` step with tests, and a reviewer checklist:

- **Never in a post:** e-mail, name, surname, phone, address, order number, offer token, invoice number, the shopper's city or street, the delivery parcel locker, the date of the order to the day, free-text notes from the CRM.
- **Allowed:** the product (public), the shop (public), the prices (ours and the shop's), the delivery time in working days, the month ("oktobrī").
- **Aggregates (types E, F):** counts only, never a path or a person. A category or product appears only above a minimum (50 views for a category, 30 for a product), so a list can never describe one visitor's week. The counts themselves are not printed in the caption unless the owner wants them; the rank is enough.
- **No invented people.** A Latvian first name presented as a buyer ("Anna no Jelgavas") is a fake testimonial even if the facts are real; it fails rule 4 (honest persuasion). The post says "pircējs" or "kāds pircējs". If the owner wants a name for warmth, the caption must say "vārds mainīts" in the same line; the recommendation is not to.
- **No quotes.** Shoppers' messages are not quoted, even anonymised, unless the shopper wrote a review for publication and ticked a box saying so (not built; not planned).
- **Images:** product photos come from the partner feed (public catalogue pictures) or the category illustration, never from an order or a shopper.
- **Anonymisation tests:** the test feeds a record with every personal field filled and asserts none of the values appears in the caption, the image text or the alt text.

The privacy policy already lists what Trilio publishes about itself; a line is added that aggregated, anonymised facts about offers may appear in Trilio's marketing.

## 6. Register (the "tu" question)

The site speaks to the shopper as "tu" (owner, 30 Oct 2026) because a one-question-per-screen flow is a one-to-one conversation. A business page speaks to the public, and Latvian business pages mostly use "jūs" or avoid the pronoun. Recommendation, for the owner to decide (D1):

- **Captions avoid direct address** wherever they can. Infinitives and statements: "Pieprasīt labāku cenu", "Trīs ieteikumi …", "Cenu vēsture un trīs alternatīvas". This is also the shorter, more Jobs-like form.
- **Where a pronoun is unavoidable, captions use "jūs"** ("Ja varam lētāk, piedāvājam; ja ne, paziņojam, kad cena krīt" avoids it; "jūsu virtuvei" when needed).
- **The site keeps "tu"**: the moment a person taps through to Trilio they are in the one-to-one flow. The switch at the door is normal in Latvian (a shop sign says "Laipni lūdzam", the assistant says "tu" once asked to).
- The same rule goes into `docs/BRAND.md` so ads, posts and the site do not drift.

## 7. Pipeline and code

```
cron 18:00 Riga ─► pick type (rules §4) ─► query data ─► compose caption (Claude, template + facts)
   ─► lint (honesty + privacy) ─► render image (satori) ─► store draft (social_posts, status "draft")
   ─► Approve mode: owner taps Publicēt in Admin → Sociālie tīkli
   ─► Automatic mode: publisher at 19:00 posts to Facebook (page feed) and Instagram (container → publish)
   ─► store post ids ─► next day: pull insights (reach, reactions, link clicks) ─► admin table
```

- **Schema:** `social_posts` (id, kind A/B/C/D/R, subcategory_id, product_id, offer_id, caption_fb, caption_ig, image_path, alt, scheduled_at, status draft/approved/published/skipped/failed, fb_post_id, ig_media_id, error, created_by "sistēma"/admin e-mail, published_at); `social_insights` (post_id, day, reach, reactions, comments, shares, link_clicks); `social_settings` (mode approve/auto, enabled, slots). Tables, migration `0020_social`.
- **Domain (pure, tested):** `src/domain/social/`: `pickKind(date, facts)`, `anonymise(record)`, `lintPost(caption, ctx)` (reuses `lintAdText` with the two extra rules), `hashtags(subcategory)`, `captionTemplates` per kind in `src/i18n/messages/lv.json` under `social.*`.
- **Services:** `src/services/social/compose.ts` (facts → caption via Claude with the template as the frame, then lint; falls back to the plain template if Claude's text fails the lint), `render.ts` (satori → PNG stored under `public/social/{id}.png`; Instagram needs a public image URL), `publish.ts` (Graph API v21+: `POST /{page-id}/photos` with `caption` for Facebook; `POST /{ig-user-id}/media` then `POST /{ig-user-id}/media_publish` for Instagram; Reels via `media_type=REELS` with a video URL), `insights.ts` (`/{post-id}/insights`, `/{ig-media-id}/insights`), `meta.ts` (token, ids, error mapping, retry with backoff, the 25-posts-a-day Instagram limit).
- **Cron:** `/api/cron/social` guarded by `CRON_SECRET` like `ingest` and `offers`; two actions `draft` (18:00) and `publish` (19:00); Railway cron entries.
- **Admin → Sociālie tīkli** (`/admin/sociali`): the queue (date, type, image preview, both captions editable, Publicēt / Labot / Izlaist), history with reach and clicks, settings (mode, enabled, slots), a "Ģenerēt tagad" button per type, and the Reels upload (video + caption → scheduled). Every action writes the audit log.
- **Attribution:** every link carries `utm_source={facebook|instagram}&utm_medium=social&utm_campaign={kind}&utm_content={post-id}`; `ad_landings` already stores UTMs, so taps on "Pieprasīt labāku cenu" per post appear in Admin → Reklāma and Statistika.
- **Env:** `META_APP_ID`, `META_APP_SECRET`, `META_PAGE_ID`, `META_IG_USER_ID`, `META_SYSTEM_USER_TOKEN` (never committed; `.env.example` updated). The same app and token serve the Meta pixel/Conversions API for ads (docs/TIKTOK_PLAN.md §3), so the set-up is done once.
- **Mock provider** for dev and tests, as the ads have (`src/services/ads/mock.ts`): records what would have been posted; e2e uses it.

## 8. Meta set-up (owner, about 15 minutes; step-by-step sent when we start)

1. Instagram as a **Business** account, linked to the Facebook page (Business Suite → Settings → Linked accounts).
2. **Meta Business Manager** owns the page and the Instagram account.
3. **developers.facebook.com → Create app → Business**; add the products *Facebook Login for Business* and *Instagram Graph API*.
4. **System user** in Business Manager (admin), assigned to the page and the Instagram account; generate a **long-lived token** with `pages_manage_posts`, `pages_read_engagement`, `pages_show_list`, `instagram_basic`, `instagram_content_publish`, `instagram_manage_insights`, `business_management`. Paste it into Railway as `META_SYSTEM_USER_TOKEN`.
5. **Publish the app (Live).** While an app is in development mode, what it posts is visible only to people with a role on the app. The privacy, terms and data-deletion URLs (trilio.lv/privatums, trilio.lv/noteikumi) are what Meta asks for. Posting to a page and an Instagram account the business owns uses the system user's own assets; if Meta asks for app review of these permissions, it takes a few days and the plan does not depend on it.
6. Verify `trilio.lv` as a domain in Business Manager (also needed for the pixel and link previews).

## 9. Decisions for the owner

| # | Question | Recommendation |
| --- | --- | --- |
| D1 | Register in captions | Avoid the pronoun; "jūs" where unavoidable; the site keeps "tu" (§6) |
| D2 | Names in type D posts | None; "pircējs". Not even changed Latvian names |
| D3 | Start mode | Approve for the first two weeks, then automatic |
| D4 | Cadence | Mon/Wed/Fri 19:00; Saturday 11:00 after reach data |
| D5 | First categories for type A | `dish`, `fridge`, `vacuum`, `washer`, then rotation by traffic |
| D6 | Show view counts in E and F captions | No: rank only ("Nedēļas trīs visvairāk skatītās"); counts invite comparison with bigger sites and add nothing for the reader |

## 10. Risks

- **Token expiry:** system-user long-lived tokens do not expire unless revoked; the publisher checks `/debug_token` weekly and alerts in Uzdevumi if it is gone.
- **Instagram publishing limits:** 25 posts per 24 hours per account; we post one. Image aspect ratio 4:5 to 1.91:1; the template renders 1080×1350 (4:5) for both networks.
- **Caption drift:** Claude's text is framed by a template and must pass the lint or the template is used verbatim; no post goes out that the lint has not passed.
- **A wrong price:** rendered and posted in one run from a live query; if the feed is older than 24 hours for that shop, the post is skipped and the owner is told.
- **Tone complaints:** Approve mode first; any post can be deleted from the admin, which deletes it on both networks.

## 11. Delivery

| PR | Scope | Effort |
| --- | --- | --- |
| 1 | Meta app wiring: env, `meta.ts`, mock provider, publish and insights for a hand-written post; admin page with the queue and settings; cron; audit; e2e | 1 PR |
| 2 | Types A, C, E and F: data queries (aggregated, thresholds), templates, images, compose with lint, scheduling rules | 1 PR |
| 3 | Types B and D with `anonymise()` and its tests; Reels upload (type R); privacy-policy line; BRAND.md register rule | 1 PR |

Unit tests for every domain rule (pick, anonymise, thresholds, lint, hashtags), service tests against the mock Graph API and Postgres, e2e for the admin queue on mobile-360 and desktop with axe. Each PR merges only green.

## 12. Status (31 Oct 2026): built

Decided by the owner: D1 (no pronoun, "jūs" if unavoidable; the site keeps "tu"), D2 ("pircējs", no names), D3 (approve first), D4 (Mon/Wed/Fri 19:00, Sunday 11:00), D5 (`dish`, `fridge`, `vacuum`, `washer`, then traffic), D6 (rank only, no counts).

- **Data:** `social_posts` and `social_insights` (migration `0020_social`). Settings (on/off, approve/auto) live in `app_flags` (`social_enabled`, `social_mode`) rather than a separate table.
- **Domain** (`src/domain/social/`, pure, tested): `schedule.ts` (Riga wall-clock slots across summer time, `pickKind`, rotation, thresholds), `lint.ts` (the ads' honesty rules plus price, "bez maksas", "ja" and "tu" checks; links, tags and data names are not text), `anonymise.ts` (`offerStory` keeps product, shop, prices, days and month; `leaks` checks every personal field of the order in any spacing), `captions.ts` (all six kinds, Facebook with the UTM link, Instagram with "Saite profilā." and five tags).
- **Services** (`src/services/social/`): `facts.ts` (live queries; a shop whose feed is older than a day is left out), `render.tsx` (1080×1350 brand template; JPEG through sharp, because Instagram takes nothing else), `meta.ts` (Graph API: page photo/video, Instagram container → publish, insights, delete, token check), `mock.ts`, `posts.ts` (draft, refresh, publish, approve, edit, skip, delete, insights), `job.ts`.
- **Schedule:** the web service's scheduler runs the job every 15 minutes (`/api/cron/social` does the same for an outside cron). Drafts appear 26 hours before the slot; an unapproved draft is skipped at its time; an approved post more than 6 hours late is skipped.
- **Before sending,** picks, price-drop and most-viewed posts read their prices again: same numbers go out as they are; changed numbers rewrite an untouched post; a post the owner edited is held back with the reason, and a drop that is gone is skipped.
- **Admin → Sociālie tīkli:** connection state, settings, "Izveidot tagad" per kind (the new draft is highlighted), the queue with the image, both captions editable (an edit must pass the same lint), Apstiprināt / Publicēt tūlīt / Izlaist, history with reach, reactions, comments and clicks, "Dzēst no tīkliem", and the Reels form (a public MP4 link, caption, day). Every action is in the audit log.
- **Image URL** `/api/social/{id}/image.jpg`: public once approved (Meta fetches it), admin-only while a draft.
- **Privacy policy:** a line on what posts use and never publish, and Meta as a recipient that receives no personal data. The profile texts and the register rule are in `docs/BRAND.md`.

- **Carousel (owner, 31 Oct 2026):** a "3 ieteikumi" post is four slides, so the post shows how easy it is, not only the result: (1) the category and "Izvēle 3 soļos"; (2) "1. solis — Daži jautājumi": the flow's first two or three plain questions with their options as pills, worded as the site asks them; (3) "2. solis — Trīs ieteikumi" with today's prices and the note "Piemērs bez atbildēm", because no answers were given for these picks; (4) "3. solis — Pērc uzreiz vai pieprasi labāku cenu": the first pick as the site's card with both buttons and "Ja varēsim piedāvāt lētāk, atsūtīsim piedāvājumu; ja ne, paziņosim, kad cena krīt". Facebook gets a multi-photo post (photos uploaded unpublished, then one feed post), Instagram a native carousel (items, then one CAROUSEL container). Slides are at `/api/social/{id}/{n}/image.jpg`; the admin queue shows all of them.

- **Social v2 (owner, 31 Oct 2026), after checking current practice:** carousels whenever a post shows three or more things: "3 ieteikumi" (4 slides), "Ko meklē šonedēļ" (a cover with the list, one slide per category with its illustration and the lowest price today, and a closing "Sākt izvēli" slide) and "Visvairāk interesēja" (a cover, then one slide per product with the site's two buttons). One fact stays one image (price drop, advice, offer). Captions lead with the fact, carry one question for comments and one topic emoji plus 👉 before the Facebook link (BRAND.md). Every slide has its own alt text made from what it shows, sent to Instagram as `alt_text` (if Meta refuses the field the image goes out without it). Images stay 4:5, the widest Meta's publishing API accepts; larger type on list slides.

- **Post images (owner, 31 Oct 2026: "Steve Jobs quality"):** one design system in `render.tsx`, the same on every slide: one idea per slide, a large Space Grotesk headline (sized by its length), one hero (a lime numeral, a price, a phone mock-up of the site, a product photo or the category drawing), typographic rows instead of boxes, the site's own buttons, a slide counter and "Ritini tālāk →" on a carousel cover, the tagline only on a closing slide. **Product photos:** a slide about one product (price drop, "pieprasīts un atrasts", a most-viewed product, the phone's product card) shows the shop's photo of it from the feed, on a white card, because feed photos are shot on white; the photo is fetched when the image is rendered (8 s limit, https on a partner host only, fitted and flattened by sharp) and when it cannot be had the category drawing stands in, so a post never fails for a missing photo. Category and list slides keep the drawings. The photos are the partner shops' product photos, used the same way as on the site.

Deviations from the plan, each small:

1. **Type F counts interest, not views.** Trilio has no product pages, so "most viewed" would be untrue. F ranks by shop clicks (one per visitor and day) plus saves in 7 days, needs 30, and says "Šonedēļ Trilio lietotājus visvairāk interesēja".
2. **Claude writes one line only:** the opening sentence of picks and advice posts. Everything with a number is the template's. A line that fails the lint is dropped for the template's.
3. **Advice skips a knowledge sentence written in the "tu" form** (2 of 116 today) and takes the category's next one.
4. **Token alert** is the connection line on the admin page (checked on every visit), not a Uzdevumi item.
5. **Free text in an order** (the owner's greeting, a delivery note) is checked for leaks only as a whole; names and addresses also word by word.

To switch it on: the Meta set-up in §8, then in Railway `FEATURE_SOCIAL=1`, `META_PAGE_ID`, `META_IG_USER_ID`, `META_SYSTEM_USER_TOKEN`. Drafts start appearing the next day; nothing is published until a draft is approved.
