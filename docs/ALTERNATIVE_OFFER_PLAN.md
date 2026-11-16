# Answering every price request: offer, alternative, or "nothing to offer" (plan, 16 Nov 2026)

The owner's case: a shopper asked for a lower price ("Iegūt lētāk") on a product, the partner cannot supply that maker's model, and the owner wants to offer an equivalent product from another maker without misleading anyone. The owner also wants to mark requests that have nothing to offer and those that only have price monitoring, so that every request has a visible outcome. Viewpoint: the admin doing this every day, on a phone if needed.

## 1. What happens today, and why it is not enough

| Today | Problem |
| --- | --- |
| Partner mark "Nav pieejams" turns the lead into `done` (`classifyLead`, src/domain/admin/crm.ts) | The shopper is never told. The request disappears from Uzdevumi with no answer sent. |
| An offer can be made for any product (`/admin/piedavajumi/jauns?product=…&request=…`) | An offer for another model would go out under `offerEmail.requestReason`: "…pieprasīji zemāku cenu **šai precei**". That is misleading. |
| The consent text and the privacy page promise an offer for the product requested | An alternative product is outside what the shopper agreed to (consent versions before this plan). |
| Lead states live on the product (`partner_requests`, `classifyLead`) | You cannot see who was answered and how. |
| Requests under 200 € only get a price alert (`worthAsking`) | They look like leads, but nothing is ever asked of a partner. They clutter the list. |

## 2. Outcomes: every request ends in exactly one

One outcome per request (per person and product), shown as a chip on every row:

| Outcome (chip) | Meaning | Shopper is told | Price monitoring |
| --- | --- | --- | --- |
| **Jauns** | Nobody has acted yet | — | on |
| **Prasīts partnerim** | Waiting for the partner (as today, per product) | — | on |
| **Piedāvāts** | An offer for the same product was sent | the offer | on |
| **Alternatīva piedāvāta** | The product is unavailable; an offer for another product was sent | §4 e-mail | on, for the original product |
| **Jautāts par alternatīvu** | Older consent: we asked whether they want an alternative, and are waiting for the click | §4.3 e-mail | on |
| **Nav ko piedāvāt · seko cenai** | Nothing Trilio can sell now; the shop price is still being watched | §4.4 e-mail (one, short) | on until `alertsUntil` |
| **Tikai cenu monitorings** | No lower price was requested (saved item, price alert, or under the 200 € line): nothing to source | nothing new | on |
| **Beidzies** | Monitoring ended (90 days, unsubscribed, deleted) | — | off |

"Tikai cenu monitorings" is set automatically for requests that `worthAsking` says not to source, and for saves without a request. These never show as "Vajag rīcību". The admin can also set it by hand ("Tikai sekot cenai").

## 3. The admin flow

### 3.1 Where the work appears

- **Uzdevumi** gets a saved view **"Nav pieejams: jāizlemj"**: products whose partner answer is "Nav pieejams" and that still have requests without an outcome. It counts as `action` (Trilio's turn), not `done`.
- **Pieprasījums** gains the outcome filter (the chips in §2) with counts, and a second line on each row: "4 pieprasījumi · 1 piedāvāts · 2 alternatīva · 1 nav ko piedāvāt".
- **Atkal pieejams**: when a product marked "Nav ko piedāvāt" is later marked "Apstiprināts" by a partner, or its shop price falls below the price people saw, its requests come back to "Vajag rīcību" with that reason.

### 3.2 The decision panel (lead page, one screen)

When the partner answer is "Nav pieejams", the top of `/admin/pieprasijums/{id}` replaces the next-step box with three large buttons:

1. **Piedāvāt alternatīvu** (§3.3)
2. **Nav ko piedāvāt**: one tap. It shows a preview of the e-mail in §4.4 with the switch "Nosūtīt paziņojumu" (on by default), the reason (preselected from §7) and the note field. Confirm. Every open request of the product gets the outcome, and those who agreed get the e-mail.
3. **Pagaidīt**: the partner expects stock. Pick a date (7 / 14 / 30 days, or a date). The lead leaves Uzdevumi and comes back on that date.

The per-request table below keeps one menu per row ("Piedāvāt šo", "Alternatīva", "Nav ko piedāvāt", "Tikai sekot cenai"), for when people need different answers.

**In bulk (Pieprasījums list):** tick rows, then "Nav ko piedāvāt" or "Tikai sekot cenai" for all of them, with one preview of the e-mail.

### 3.3 Choosing the alternative (three steps, prefilled)

1. **Suggestions, not a search box.** Trilio lists up to five products from the same subcategory, from other makers, that are in stock at a shop. They are sorted by the normal ranking score (src/domain/ranking), never by margin, so commission cannot steer the choice (product rule 4). Each suggestion shows its shop price and the comparison verdict from step 2. A search field is still there below the list.
2. **Side-by-side comparison** of the original and the alternative on the category's key attributes (from data/categories.json and attributes.json: capacity, energy class, noise, size, key functions, warranty). Each line is marked **labāk / tāpat / sliktāk / nav datu**. A pure function decides the label the e-mail may use:
   - **"līdzvērtīgs"** only if no key attribute is worse and none of the original's must-haves (the shopper's answers, when the request carries `answersParam`) is missing;
   - otherwise **"līdzīgs"**, and the e-mail lists every attribute that is worse.
   The admin cannot override the label. They can add one sentence of their own ("Šis modelis ir no tās pašas rūpnīcas…"), checked by the existing honesty lint.
3. **Price and send.** This is the normal offer form, prefilled: cost from the partner mark, "Sūtīt visiem, kas pieprasīja {original}" ticked. Two price checks block sending:
   - the offer price must be **below the alternative's own lowest shop price**, because otherwise there is no reason to buy from Trilio;
   - it must also be **no higher than the original's price the shopper saw**. If it is higher, the form says so and the e-mail states the difference.
   The e-mail preview (EmailPreview) shows exactly what goes out, then the admin sends it.

The offer row stores `alternative_to_product_id` and a frozen `comparison` snapshot (as reference prices are frozen today), so the e-mail and the offer page read the same later even if the catalogue changes.

### 3.4 Pictures and description (owner, 16 Nov 2026)

The offer form, for every offer and not only alternatives, gets a **"Bildes un apraksts"** block:

- **Pictures, up to 4.** Each one can be added in either of two ways:
  - **No datora**: a file field with drag and drop on desktop. On a phone it opens the camera or the gallery. JPEG, PNG or WebP, up to 10 MB.
  - **No saites**: paste an address (for example the maker's or the distributor's product page picture), then press "Pievienot".
  
  Either way, the server stores **its own copy**. It never links to the original address, so the e-mail and the offer page still work if that page changes, and the shopper's mail client never calls a third-party server. Each picture is resized with `sharp` to at most 1600 px and saved as JPEG with EXIF data (location, camera) removed. The first picture is the main one, and arrows change the order. When the catalogue has a picture for the product, it is there by default and can be removed.
- **Alt text** for each picture. It is required (accessibility) and prefilled with the product name.
- **Rights check**: a tick box "Man ir tiesības izmantot šo bildi" is required for pictures from a link. Who added a picture, and from which address, goes to the audit log.
- **Description ("Apraksts")**: plain text with line breaks, up to 1 500 characters, with a live preview. On the offer page and in the e-mail it appears under the heading **"Trilio apraksts"**, so it is clear Trilio wrote it and not the maker. It passes the existing honesty lint, which blocks "tikai šodien", "pēdējie", countdowns and similar wording. It is an addition: it never replaces the comparison table, and a "līdzvērtīgs" claim in the text is blocked when the comparison label is "līdzīgs".
- **A product not in the catalogue** (a model the distributor has that no partner shop lists): "Prece nav katalogā" opens fields for name, brand, model code, EAN and the category's key attributes. Attributes left empty show as "nav datu" in the comparison, never as "tāpat". Pictures and description are then required, because there is nothing else to show. Discount claims are not allowed for such a product, since there is no 30-day shop price (rule 5); the e-mail shows only the offer price and the original's price.

Security for the link option: HTTPS only, public addresses only (no internal or private IPs, so the server can't be made to fetch internal URLs (SSRF)), at most 3 redirects, 10 s, 10 MB, and the bytes must decode as an image. If the link fails, the form says why ("Saite nav bilde", "Pārāk liela", "Neizdevās ielādēt") and keeps what was typed.

## 4. What the shopper sees (honest by construction)

### 4.1 Alternative offer e-mail (consent version from this plan onward)

- **Subject:** "{Original} šobrīd nav pieejams — varam piedāvāt {Alt}". It is never just "Tavs piedāvājums", so the swap is clear before the e-mail is opened.
- **First line:** "Tu {date} pieprasīji zemāku cenu precei {Original}. Mūsu partneriem tā šobrīd nav. Tā vietā varam piedāvāt citu ražotāja modeli: {Alt}."
- **Comparison table** from the snapshot, with the worse lines shown, not hidden.
- **Prices:** the offer price; the alternative's lowest shop price now and its 30-day low (Omnibus); the original's price they saw.
- **Two buttons:** "Apskatīt piedāvājumu" and **"Gribu tikai {Original}"**. The second declines the alternative. The outcome stays "Alternatīva piedāvāta · atteica", and monitoring of the original continues.
- **Footer:** "Turpinām sekot {Original} cenai līdz {alertsUntil}."

The offer page `/piedavajums/{token}` repeats the line "Šis nav tevis pieprasītais modelis" above the product, with the same table.

### 4.2 Consent text (new version)

The request form and the privacy page add: "…vai, ja šī prece nav pieejama, par vienu līdzvērtīgu citas ražotāja preci." This bumps the consent version (as with `2026-11-09.2`). Only requests with the new version can be sent an alternative offer directly.

### 4.3 Older requests: ask first

For requests made under an earlier consent, the admin flow sends an e-mail instead of the offer: "{Original} šobrīd nav pieejams. Gribi, lai piedāvājam līdzvērtīgu citu ražotāja preci?" It has the buttons **"Jā, piedāvājiet"** and **"Nē, tikai sekojiet cenai"**. A "Jā" click records consent for that one alternative. If the admin already prepared the alternative, it is sent at once; if not, the request returns to Uzdevumi. A "Nē" click sets "Nav ko piedāvāt · seko cenai".

### 4.4 "Nothing to offer" e-mail

This is one short message per request, never repeated: "Šobrīd nevaram piedāvāt {Original} lētāk nekā veikalos. Turpinām sekot cenai un uzrakstīsim, ja tā samazināsies — līdz {alertsUntil}. Atteikties: {link}." It has no other product, no advertising and no urgency.

## 5. Data and code

- **Schema:** a new table `request_outcomes` (id, product_id, notify_request_id null, user_id null, email, outcome enum from §2, offer_id null, alternative_product_id null, wait_until null, note, created_by, created_at, notified_at, answered_at, answer `yes|no|declined` null). The newest row per request wins, and older rows are the history. `special_offers` gets `alternative_to_product_id`, `comparison jsonb`, `description` and `manual_product jsonb` (for a product not in the catalogue). The new table `offer_images` (offer_id, position, bytes bytea, width, height, alt, source `upload|url`, source_url, added_by, created_at) is stored like `social_images` and served at `/piedavajums/{token}/bilde/{n}.jpg`. A picture is deleted together with its offer. `notify_requests` needs nothing new: the consent version is already stored.
- **Domain (pure, tested):** `src/domain/offers/alternative.ts` holds `compareProducts(original, alt, category, answers)` → lines and the label `equivalent | similar`, `suggestAlternatives(candidates, original)` (ranking order, other makers, in stock), `alternativePriceCheck(...)` and `canOfferAlternative(consentVersion)`. `src/domain/admin/crm.ts` gains the `classifyLead` changes: "unavailable with open requests" becomes `action` with next step `decide_unavailable`, plus `wait_until` and "back in stock".
- **Services:** `services/offers/alternative.ts` (suggestions, snapshot, send to all requesters), `services/admin/outcomes.ts` (set an outcome one at a time or in bulk, send the e-mail, audit log and `offer_events`).
- **Copy:** in lv.json, with English in en.json and lt/et scaffolded: the e-mails in §4, the chips, the panel, the consent and privacy text (new version).
- **Rules kept:** ranking is never by commission (rule 4); discount claims use the 30-day low (rule 5); no countdowns or urgency; shop names come from configuration.

## 6. PRs

1. **Domain and data:** outcomes, comparison and label, price check, consent version, migration, unit tests.
2. **Admin:** decision panel, pictures (upload or link) and description in the offer form, product not in the catalogue, suggestions and comparison screen, prefilled offer form, bulk actions, Uzdevumi view "Nav pieejams: jāizlemj", "Atkal pieejams", outcome filter and chips, CSV.
3. **Shopper side:** the alternative e-mail and offer page banner, pictures and "Trilio apraksts" in the e-mail and on the offer page, "Gribu tikai {Original}", the ask-first e-mail for older consents, the "nothing to offer" e-mail, consent and privacy text.
4. **e2e at 360 px and desktop with axe:** unavailable → alternative → shopper sees the swap and the table → accepts; unavailable → nothing to offer → e-mail → monitoring continues; old consent → ask → "Jā" → offer; bulk "Tikai sekot cenai"; upload a picture from a file and add one from a link (local test server), wrong link → clear error, alt text required; "Atkal pieejams" brings a lead back.

## 7. When is there "nothing to offer"?

The admin decides; Trilio never closes a request on its own (no time limits, owner 30 Oct 2026). Trilio does show the evidence, and suggests "Nav ko piedāvāt" with its reason when one of these holds:

| Reason (shown on the row and stored with the outcome) | How Trilio knows |
| --- | --- |
| **Partneris nevar lētāk** | The partner confirmed a cost, and that cost plus the minimum margin is at or above the lowest shop price now. Trilio could only sell at a loss or above the shops. Computed from the partner mark and live shop prices. |
| **Nav pieejams, un nav alternatīvas** | The original is marked "Nav pieejams", and none of the suggested alternatives passes: no partner confirmed one, or none passes the price check (§3.3) and the "līdzvērtīgs/līdzīgs" comparison. |
| **Visi partneri atteica** | Every partner asked for this product (the `partner_requests` history) answered "Nav pieejams". |
| **Cits iemesls** | The admin's own reason, typed in the note. |

The suggestion is a chip on the row ("Ieteikums: nav ko piedāvāt · Partneris nevar lētāk"), and the decision panel preselects that reason. The admin confirms with one tap. The minimum margin is a setting in Admin → Sistēma (default 3 %), not code. If the evidence changes later (the shop price rises, a partner confirms), "Atkal pieejams" (§3.1) brings the request back.

## 8. Decided (owner, 16 Nov 2026)

1. Older requests: ask first, then offer.
2. The "nothing to offer" e-mail is sent by default; the admin decides with Trilio's suggested reason (§7).
3. An alternative may not cost more than the original's price the shopper saw (a hard rule).
4. One alternative per request.
