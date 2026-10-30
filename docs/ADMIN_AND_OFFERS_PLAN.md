# Admin section, visitor statistics and personal offers

Owner, 24 Oct 2026: as admin I need to see visitor statistics and the most visited sections, see each user's saved items and products, and send them custom special offers. I will source specific items from distributors and offer a better price than the monitored shops. The shopper needs an easy form to accept the offer and fill in payment and delivery data. Delivery in Latvia is always free. The admin section is for one account only. Plan ahead for functions that will be useful.

This plan covers the data model, the admin pages, the shopper's side (offer → order → payment → delivery), the legal frame, and the delivery order. Nothing here changes the public ranking.

## 1. What already exists and is reused

| Need | Already in the code |
|---|---|
| Who is signed in | Auth.js with Google and magic link; `currentUserId()` in `src/auth.ts`. JWT session carries the user id. |
| Users and their favourites | `users`, `saved_items` (products and saved searches, with the baseline price), `notify_settings`, `subscriptions`. |
| What people search | `search_sessions`: subcategory, answers and budget of every results page shown. |
| Clicks to shops | `affiliate_clicks`: offer, shop, time (no identity). |
| Price history | `price_snapshots` (lowest price per day, the 30-day low for Omnibus claims), `offers` (live prices per shop). |
| Payments | `PaymentProvider` (`src/services/payments/types.ts`): Paysera Checkout one-off payments with signed callbacks, and the `mock` provider for development and CI. Pending Paysera credentials (task #31). |
| E-mail | Resend through `createEmailSender()`; plain text plus minimal HTML. |
| Delivery dates | Working-day calendar with LV holidays (`src/domain/delivery`). |
| Jobs | `runAllJobs` (ingestion, extraction, wishlist digest, purges) on the web service's scheduler. |
| GA4 | Opt-in only, so it under-counts; good for funnels, not for totals. |

The admin section therefore starts as views over data Trilio already stores. New tables are needed only for first-party visit counts, consent, offers, orders and the audit log.

## 2. Guardrails (decided by the product rules, confirm the legal ones)

1. **Access.** The admin is whoever is listed in `ADMIN_EMAILS` (comma-separated; set to the owner's address in Railway). Addresses are configuration, not code (CLAUDE.md rule 7 in spirit). An empty variable disables the section. The check runs server-side in `src/app/admin/layout.tsx` on every request: not signed in → redirect to `/ienakt?callbackUrl=/admin`; signed in but not listed → 404, so the section's existence is not confirmed. The dev login (`AUTH_DEV_LOGIN`) can be an admin only under `ALLOW_INSECURE_TEST_FEATURES=1` (CI). `/admin` is `noindex` and disallowed in `robots.ts`.
2. **Audit.** Every admin write (offer created, sent, cancelled; order marked paid, shipped, refunded; consent viewed in bulk) is a row in `admin_audit`: who, what, which record, when, from which IP. Read-only pages are not logged.
3. **Consent for offers (GDPR and the Latvian Information Society Services Law).** A personal offer by e-mail is a commercial communication. It may be sent only to users who ticked **"Vēlos saņemt personīgus piedāvājumus par saglabātajām precēm"** (opt-in, unticked by default, in the wishlist page and in `/konts`). Every offer e-mail carries a one-click unsubscribe link that needs no login. The privacy policy gains a paragraph: what is sent, on what basis (consent), how to withdraw. Users who have not opted in are visible in the admin, but the "Sūtīt" button is disabled for them with the reason.
4. **Trilio as seller.** Accepting an offer is a distance-selling contract between the shopper and Trilio's company, not a partner shop. That means: company details and VAT on the invoice, a 14-day withdrawal right, a 2-year legal guarantee, purchase terms ("Pirkuma noteikumi", a new legal page), and a returns procedure. *Owner decisions needed:* who pays return shipping (recommendation: Trilio, because "bezmaksas piegāde" is the promise and a paid return undercuts it), the warranty handler (distributor or Trilio), and whether invoices come from Trilio's accounting software or are generated here (plan: generated here as HTML/PDF, numbered `TR-2026-0001`, with a CSV export for the accountant).
5. **Honesty (rule 4).** The offer page shows the real live best price in the monitored shops and, when true, the saving against the lowest price of the previous 30 days (rule 5). An offer has a real expiry because the distributor's quote has one; no countdown timers, no "3 people are looking at this". The shopper gets at most one reminder before expiry, and only if the offer was never opened.
6. **Ranking neutrality.** Trilio's own offers never appear in the public results or landing pages, and never influence the ranking. They exist only on the private offer page of the person they were made to. The "Kā mēs izvēlamies" panel stays true.
7. **New and refurbished are never mixed (rule 1).** An offer has a condition; a refurbished offer states the grade, the warranty and the saving versus new.
8. **Delivery.** Free in Latvia, always; the shopper never sees a delivery price field. The estimate is in working days with the public-holiday calendar (rule 6). Addresses are LV only in v1 (postcode `LV-1234`); LT/EE come with the other markets.

## 3. Data model

```
visits            first-party page views: day, path, section, subcategory, visitor_hash  (raw, purged after 35 days)
visit_daily       rollup: day, section, subcategory, path, views, visitors
users             + offers_opt_in (bool), offers_opt_in_at, offers_unsubscribe_token
special_offers    one offer to one user for one product
offer_orders      an accepted offer with delivery data; linked to a payment and an invoice
offer_order_events timeline: created, paid, packed, shipped (tracking), delivered, withdrawn, refunded
payments          subscription_id becomes nullable; + offer_order_id (one-off order payments reuse the same table, callbacks and idempotency)
invoices          number, order, amounts, VAT, pdf/html snapshot
admin_audit       admin_user_id, action, target_table, target_id, details jsonb, ip, created_at
```

**Visits without cookies.** Counting happens server-side after the response is sent (`after()` from `next/server`) for page routes only, never for `/api`, `/_next` or bots (user-agent list). `visitor_hash = sha256(day_salt + ip + user_agent)` with a salt that rotates daily and is never stored, so a visitor cannot be followed across days. This is the method of consent-free analytics tools (Plausible, Fathom) and needs a line in the privacy policy ("legitimate interest, no cookies, 35 days"). GA4 stays for funnels among consenting visitors. The admin dashboard shows both and says which is which.

**special_offers**

| Column | Notes |
|---|---|
| `user_id`, `product_id` | one offer per person per product; "offer to everyone who saved it" creates one row per person |
| `condition` | `new` or `refurbished`; `refurb_grade`, `warranty_months` |
| `price_cents` | what the shopper pays, VAT included; delivery is 0 by rule |
| `reference_price_cents`, `reference_low30_cents`, `reference_store_id` | the monitored best price and the 30-day low at creation, frozen so the e-mail and the page claim what was true when sent |
| `quantity` | how many units the admin can supply; "1" by default |
| `delivery_working_days` | estimate; shown as a date |
| `valid_until` | real expiry |
| `message` | the admin's personal note (optional) |
| `supplier_note`, `cost_cents` | admin-only: distributor, purchase price, so the margin is visible in the list; never sent to the shopper, excluded from the GDPR export |
| `token` | 32 random bytes, the public link `/piedavajums/{token}` |
| `status` | `draft → sent → opened → accepted → paid → shipped → delivered`, side exits `expired`, `cancelled`, `withdrawn` (14 days), `refunded` |
| `sent_at`, `opened_at`, `reminded_at` | |

**offer_orders**: `offer_id`, `user_id`, `full_name`, `phone`, `email`, `street`, `city`, `postcode` (LV-dddd), `country` (`LV`), `delivery_note`, `payment_id`, `invoice_id`, `tracking_url`, `status` mirrored from the offer. Address fields are personal data: included in the GDPR export, deleted with the account (orders keep an anonymised copy for accounting, as the law requires invoices to be kept).

## 4. Admin pages (`/admin`, Latvian UI, mobile-friendly)

The admin uses the same AppShell with a narrow sidebar: Pārskats · Statistika · Lietotāji · Pieprasījums · Piedāvājumi · Pasūtījumi · Sistēma.

### Pārskats (dashboard)
For today, 7 and 30 days, each with the change against the previous period:
- Visitors and page views (first-party), consenting-visitor funnel (GA4 link-out).
- Searches by category (from `search_sessions`), sign-ups, saves, clicks to shops.
- Offers pipeline: sent, opened, paid, revenue, margin.
- Health: last ingestion per shop with failures, EPREL coverage, LLM calls and estimated cost today, e-mail send failures.

### Statistika
- **Sadaļas:** page views and visitors per section and path, sortable, with a date range picker.
- **Kategorijas:** searches per subcategory, with the budget distribution (median and quartiles) and the most chosen answers per question. This tells the owner *what* people want and *how much* they plan to pay, which is the sourcing signal.
- **Veikali:** clicks per shop and per subcategory, from `affiliate_clicks`.
- Every table has "Lejupielādēt CSV".

### Lietotāji
- List: e-mail, name, signed up, last seen, saved products, saved searches, digest subscription, offers opt-in, offers sent / bought. Search by e-mail or name.
- User page: saved products with today's best monitored price and the change since saving; saved searches with the current pick; the offers and orders history; the admin's private notes (CRM, `admin_notes` on the user). Button "Izveidot piedāvājumu" next to each saved product, prefilled.
- No passwords, tokens or payment data are shown. Deleting a user is done by the user (GDPR self-service already exists); the admin can only see and message.

### Pieprasījums (demand)
- Products ranked by how many users saved them, with the best monitored price, the 30-day low and the number of those users who opted in. This is the sourcing list: one glance shows "12 people saved this washer, best shop price 489 €, 30-day low 479 €". Button "Piedāvāt visiem" creates a draft per opted-in user.
- Filter by subcategory and by minimum savers.

### Piedāvājumi
- **Form** (`/admin/piedavajumi/jauns`): recipient (user search, or "everyone who saved" from Pieprasījums), product (search by name or EAN; shows photo, EPREL badge, specs), condition and warranty, price, quantity, delivery estimate in working days, valid until (default 7 days), personal message, supplier note and cost (private). The form shows live: best monitored price and shop, 30-day low, the saving the e-mail will claim (or "Bez ietaupījuma apgalvojuma" when the price is not below the 30-day low), and the margin. It refuses to send an offer whose price is zero, whose product is not found or whose recipient has not opted in.
- **Preview** of the e-mail and the page before sending; "Saglabāt melnrakstu" and "Nosūtīt".
- **List:** pipeline view with status chips, filters, and bulk actions (cancel drafts, extend validity). Each row: user, product, price, saving, margin, sent/opened/paid times.

### Pasūtījumi
- List of paid orders with delivery data, status, invoice link and payment reference.
- Actions with audit: "Atzīmēt kā nosūtītu" (asks for tracking URL; e-mails the shopper), "Piegādāts", "Atgriešana saņemta" / "Atmaksāt" (refund is recorded here; the money is returned in the Paysera account, or by bank transfer, and the action asks for the reference), "Atzīmēt kā apmaksātu (bankas pārskaitījums)" for the period before Paysera is live or for shoppers who prefer transfer.
- Printable packing slip and invoice; CSV export for accounting.

### Sistēma
- Ingestion runs per shop with errors, "Palaist tagad" per shop (re-uses the cron route's logic).
- EPREL lookups: found / not found / error counts, retry button.
- LLM: calls, cache hit rate and estimated cost per purpose for the day and the month.
- Feature flags and configuration as the server sees it (read-only; secrets masked).
- Kill switch: "Apturēt visus piedāvājumu e-pastus" (a flag in the DB, honoured by the sender).

## 5. The shopper's side

1. **E-mail** "Personīgs piedāvājums: {product} par {price} €": product name and photo, the price, "Veikalos šobrīd no {ref} €" and, when true, "par {x} € lētāk nekā zemākā cena pēdējās 30 dienās", condition and warranty, "Piegāde Latvijā bez maksas, līdz {date}", valid until, the admin's note, one button "Skatīt piedāvājumu", and the unsubscribe link. Sent from `EMAIL_FROM`, replies go to `COMPANY_EMAIL`.
2. **Offer page** `/piedavajums/{token}`: the same facts as a Trilio result card (photo, EPREL badge, specs, Trilio rating, energy cost) plus the offer box and the comparison against the monitored shops. Viewing needs no login (the token is the key). Opening records `opened_at`. An expired or cancelled offer says so and links to the product's current shop offers instead, so the page is never a dead end.
3. **Accept:** the offer link was e-mailed to the account's address, so it already proves what a magic link proves. "Pieņemt piedāvājumu" therefore signs the recipient in on the spot (a single-use sign-in bound to the offer, valid while the offer is), and no second e-mail interrupts the flow. The order is tied to the account and appears under "Mani pasūtījumi". A link that was forwarded can only buy for the account that received it, with delivery to an address the account holder enters, and every sign-in through an offer link is logged. Then **one form**: name, phone, e-mail (prefilled from the account), street, city, postcode (validated `LV-dddd`), optional delivery note; a line "Piegāde Latvijā: bez maksas · līdz {date}"; the price; a checkbox agreeing to the purchase terms and acknowledging the 14-day withdrawal right (the legally required wording, no pre-ticked boxes); the button "Apmaksāt {price} €". A second checkbox for refurbished goods confirms the grade was understood.
4. **Payment:** `PaymentProvider.createPayment` with the order id; the shopper pays on Paysera's hosted page (card, bank links, Apple/Google Pay as Paysera offers them); the callback marks the order paid, issues the invoice and sends "Pasūtījums saņemts" with the invoice attached. The mock provider drives development and e2e. Until Paysera is live, the form can offer "Bankas pārskaitījums" with the invoice's details, and the admin marks the order paid by hand (audited).
5. **After payment:** `/konts/pasutijumi` lists orders with status, tracking link and invoice. E-mails on shipped (with tracking) and delivered. Withdrawal within 14 days: a button that opens a pre-filled message to `COMPANY_EMAIL` and records `withdrawn`; the admin completes the refund.
6. **Unsubscribe** `/piedavajumi/atteikties/{token}`: one click, confirms, sets `offers_opt_in = false`.

## 6. Delivery order

Each PR has unit tests for the domain logic and Playwright e2e on mobile-360 and desktop. The admin e2e signs in with the dev login as an `ADMIN_EMAILS` address (CI only).

**PR 1 — Admin shell, access, audit, dashboard, first-party visits.** `ADMIN_EMAILS`, layout gate (401/404 paths tested), `admin_audit`, `visits` and `visit_daily` with the rollup and purge in `runAllJobs`, Pārskats and Statistika from existing tables, CSV export, robots and noindex, privacy policy line about visit counting. Sistēma page (read-only parts).

**PR 2 — Users, demand, consent.** Lietotāji and Pieprasījums pages, admin notes, the offers opt-in in the wishlist and account pages, unsubscribe route, privacy policy paragraph. The GDPR export includes the consent flag and the notes about the user.

**PR 3 — Offers and orders.** Tables, the admin offer form with live reference prices and margin, preview, sending (Resend), the public offer page, accept → sign-in → order form → mock/Paysera payment → confirmation and invoice, "Mani pasūtījumi", admin order actions with e-mails, purchase terms page, Omnibus-safe saving claims (tested: no claim when the price is not below the 30-day low). Payments table change (nullable subscription, order link) with a migration that keeps existing rows.

**PR 4 — Operations.** Bulk offers from Pieprasījums, the one reminder before expiry, kill switch, bank-transfer path, refunds and withdrawals, packing slip, accounting CSV, "Palaist tagad" ingestion and EPREL retries, LLM cost view, dashboard trend charts.

## 7. Useful later (planned for, not built yet)

- **Supplier price import:** paste or upload a distributor price list (EAN, cost, stock). The demand page then shows margin against the monitored best price for every saved product and proposes offers sorted by margin × savers.
- **Price-rise alerts for the admin:** when the monitored best price of a frequently saved product rises, the margin on a sourced unit grows; an admin digest lists these.
- **Offer templates:** saved message texts and default warranty/delivery per subcategory.
- **Push channel:** users with web push get the offer as a notification too (opt-in is the same consent).
- **Conversion report:** sent → opened → accepted → paid per subcategory and per price gap, to learn what discount actually sells.
- **Returns/RMA:** a return record per order with reason, state and refund, replacing the e-mail-and-note flow.
- **Roles:** when a second person helps, replace `ADMIN_EMAILS` with a `user_roles` table (admin, viewer) without changing the pages.
- **Markets:** LT/EE addresses and delivery rules when those markets open; free delivery is an LV rule, the others get their own.
- **Accounting integration:** push invoices to the owner's accounting software when it is chosen.

## 8. Owner decisions (24 Oct 2026)

1. **Return shipping is paid by Trilio.** The withdrawal flow issues a prepaid return label or arranges courier pick-up; the shopper never pays to send goods back.
2. **Trilio is the seller.** The invoice comes from Trilio; Trilio buys from the distributor afterwards. The order and invoice records are therefore Trilio's sales ledger (accounting CSV in PR 4). Warranty claims come to Trilio, which handles them with the distributor; the shopper has one contact.
3. **Payments only through Paysera Checkout.** No bank-transfer path. PR 3 ships with the mock provider for development and CI and goes live when Paysera approves the project (task #31). The order form is not shown to shoppers until `PAYMENTS_PROVIDER=paysera` is configured; until then an accepted offer ends with "Maksājumu pieņemšana tiek sagatavota, mēs rakstīsim" and the admin sees the acceptance.
4. **Reminder: always one**, two days before expiry, to every recipient who has not accepted or unsubscribed, in Trilio's voice (brand awareness). Exactly one per offer, never more; the e-mail says it is the last message about this offer.
5. **Cookie-less visit counting is accepted.** It follows the practice of Plausible, Fathom and Simple Analytics: no cookie, daily-rotating hash, 35-day raw retention, aggregated counts kept. One sentence in the privacy policy under legitimate interest.
6. **Not VAT-registered yet; registration is planned.** Invoices show "PVN nav piemērojams (nav reģistrēts PVN maksātājs)" until `COMPANY_VAT_NO` is set; from then on the invoice shows the net amount, 21 % VAT and the total, and the offer form shows the net/VAT split for the admin. The shopper's price is always the full amount to pay. The switch is configuration (the existing `COMPANY_VAT_NO` variable), no code change.

## 9. Private and business buyers

Both kinds of buyer accept the same offer, but the contract and the invoice differ, so the order form asks first: **"Pērku kā" → "Privātpersona" / "Uzņēmums"**.

| | Privātpersona (B2C) | Uzņēmums (B2B) |
|---|---|---|
| Form fields | name, phone, e-mail, delivery address | plus company name, registration number (11 digits, checked), VAT number (optional, `LV` + 11 digits), legal address if different from delivery |
| Invoice | name and address | company name, registration and VAT numbers, legal address; "Rēķins" with the payment reference |
| Withdrawal | 14 days without a reason (Consumer Rights Protection Law); the order page has the button | none by law; the form says so before payment ("Uzņēmumiem 14 dienu atteikuma tiesības nav piemērojamas") |
| Guarantee | 2-year legal guarantee against Trilio; claims through Trilio | manufacturer's warranty as stated in the offer (`warranty_months`); terms say claims go through Trilio |
| Refurbished | grade, warranty and saving shown (rule 1) | same |

Data: `offer_orders.buyer_kind` (`person` / `company`), `company_name`, `company_reg_no`, `company_vat_no`, `legal_address`. The purchase terms page has a B2C and a B2B section. The admin order list shows the buyer kind, and the accounting CSV exports both the invoice number series and the buyer details.

## 10. Order tracking (owner, 24 Oct 2026)

Both sides must see where an order is, and the delivery date must be recorded: the 14-day withdrawal period of a private buyer starts on the day the goods are received, and the warranty runs from it.

**Data.** `offer_orders` gains `carrier` (`omniva`, `dpd`, `venipak`, `latvijas_pasts`, `courier_other`), `tracking_number`, `tracking_url` (built from the carrier's public tracking page and the number, or pasted for "other"), `shipped_at`, `delivered_at`, `delivery_confirmed_by` (`carrier`, `admin`, `buyer`). Every change is a row in `offer_order_events` (status, time, source, note), which is the timeline both sides see.

**Statuses shown to the buyer** (Latvian): Apmaksāts → Sagatavots sūtīšanai → Nodots kurjeram (with the carrier, the tracking number and a link to the carrier's tracking page) → Piegādāts (date). Side exits: Atgriešana pieteikta → Atgriešana saņemta → Atmaksāts.

**Where it appears.**
- Buyer: `/konts/pasutijumi/{id}` with the timeline, the tracking link, the invoice, the withdrawal button (private buyers, 14 days from `delivered_at`) and a button **"Saņēmu preci"** that records delivery when the carrier's status is late. E-mail on every status change: shipped (with the tracking link), delivered (with the withdrawal and warranty information), return received, refunded.
- Admin: the order page has the same timeline plus the actions "Sagatavots", "Nodots kurjeram" (carrier and tracking number; the URL is built automatically), "Piegādāts", notes. The Pasūtījumi list shows the status, days since shipping, and highlights orders shipped more than 5 working days ago without a delivery status, so lost parcels are noticed.

**Automatic updates (PR 4).** A job polls the carriers' tracking for open orders twice a day and records transit and delivery events, so the admin rarely has to mark "Piegādāts" by hand: Omniva and Latvijas Pasts have public tracking endpoints by parcel number; DPD Latvija and Venipak need an account and API key (`DPD_API_KEY`, `VENIPAK_API_KEY`, optional). A carrier's "delivered" sets `delivered_at` with `delivery_confirmed_by = carrier`; the buyer's button or the admin can still correct it, and the correction is audited.

**Shipping labels (later).** When the volume justifies it, the same carrier accounts can create the shipment and print the label from the admin order page (Omniva and DPD offer this in their APIs), filling the tracking number automatically. Until then the admin ships through the carrier's own portal and pastes the number.

**PR placement.** Fields, timeline, buyer page, admin actions and e-mails are part of PR 3; carrier polling and the late-parcel highlight are PR 4; label printing is in §7.

> Since 30 Oct 2026 the admin home is **Uzdevumi**, a CRM worklist over leads, offers and orders that replaces Šodien (docs/CRM_PLAN.md).

## 11. Product principles for this section (UX review, 24 Oct 2026)

The question to ask of every screen: what is the one thing the person came to do, and can they do it without reading? What follows is what that adds to the plan, and what it removes.

### The shopper

1. **One offer, told plainly and well (owner decision, 30 Oct 2026; replaces "a note from a person").** The offer e-mail is a short, confident pitch in Trilio's brand: a night-green header with the logo, one headline, the product picture, the price as the largest thing on the page, three short perks (free delivery in Latvia; working days after payment with the date if paid today; warranty), one lime button "Pasūtīt par {price}", the validity date, and "Kāpēc lētāk?" only when the e-mail claims a saving. Subject: "{product} par {price}", with ". Lētāk nekā veikalos." added only when the saving is true; the product name drops the shop's trailing type word and is cut at a comma after 40 characters. Signed "{name}, Trilio" when OFFERS_SENDER_NAME is a person, otherwise "Trilio komanda"; replies go to the company inbox. The honesty rules hold: the saving is measured against the lowest shop price of the last 30 days (Omnibus), no countdowns, no "only today", and "Ja šī prece tev vairs nav vajadzīga, nekas nav jādara." Every message has a plain-text part with the same words, and the reminder and order e-mails use the same branded shell. The admin preview shows the HTML e-mail itself.
2. **One screen, one decision.** The offer page shows the price large, one sentence on the saving (only when true), one line on delivery with a date, one line on warranty, and one button. The specs the shopper already knows sit below the fold in the familiar Trilio card. A short "Kāpēc lētāk?" line explains the mechanism honestly: "Trilio iepērk tieši no izplatītāja un piegādā pats, tāpēc var piedāvāt lētāk." Validity is a date ("spēkā līdz piektdienai, 31. oktobrim"), never a countdown.
3. **Checkout fits one phone screen.** No sign-in step (see §5.3), no account creation, no password. Seven fields at most: Pērku kā, vārds, telefons (the courier calls, say so under the field), iela, pilsēta, pasta indekss, piezīme. E-mail is already known and shown, not asked. Browser autofill works because the fields use standard `autocomplete` names. The company variant adds its fields only after "Uzņēmums" is tapped. One checkbox for the terms. The button names the amount: "Apmaksāt 449 €".
4. **Delivery is a promise, not a menu.** Large appliances: "Kurjers līdz durvīm, bez maksas, līdz {date}". Small appliances also offer "Pakomāts" (Omniva/DPD lockers are how Latvia receives small parcels) with a locker picker by city, because for a kettle a locker beats waiting for a courier. The product's subcategory decides which options appear; the shopper never sees a delivery price because there is none. For large appliances the form asks one yes/no: "Vai vajadzīga ienešana (stāvs, bez lifta)?", so the courier comes prepared.
5. **The order page is the receipt.** One status line in words ("Kurjers piegādās ceturtdien"), the tracking link, the invoice, and the two things the person may need later: "Atteikties 14 dienu laikā" and "Garantija: 2 gadi, rakstīt Trilio". Nothing else.
6. **Ask once whether all is well.** Seven days after delivery, one e-mail with one question and two buttons: "Viss kārtībā" / "Ir problēma". The second opens a pre-filled message. This catches problems before they become disputes and ends the conversation politely. It is not a review request and is not used as a rating.
7. **The consent is asked at the right moment.** When a shopper taps the heart, the save confirmation offers one line with a checkbox: "Ja atradīšu lētāk, pastāstīt pa e-pastu?" That moment has the intent; a setting buried in the account page does not. It stays available in `/konts` and in the wishlist for later. Unticked by default, as the law requires.
8. **Same design language everywhere.** The offer page, the checkout and the order page use the Trilio shell, tokens and cards; nothing looks like a separate shop. The only new visual element is the offer box, with the brand's lime accent on the one button.

### The admin

9. **Start with today, not with charts.** The first admin screen is **"Šodien"**: what needs a hand, as a list that empties — orders to ship, parcels late, offers expiring tomorrow, accepted offers waiting for payment, a shop whose ingestion failed. When the list is empty, the screen says so and shows the day's three numbers (visitors, searches, offers paid). Charts live one tap away under Statistika. The daily routine should take five minutes on a phone.
10. **An offer in under a minute.** From Pieprasījums or a user's saved product, the form opens with everything prefilled except the price. Typing the price updates the saving, the margin and the e-mail preview live. Send is one tap; the preview *is* the e-mail, there is no separate template editor.
11. **Phone-first admin.** The owner will do this from a phone between other things: 44 px targets, one column, the actions as big buttons at the bottom of the order page, tracking number entered with the numeric keyboard, the carrier chosen from four chips.
12. **One number that matters.** Offers paid ÷ offers sent, per month, shown on Šodien. Revenue and margin are there too, but this ratio tells whether the offers are good.

### What this section deliberately does not have

Coupons and discount codes, loyalty points, a chat widget, in-app notification centres, tracking pixels and open-rate tracking in e-mails (opening is recorded only when the offer page is visited), A/B tests on prices, a CRM pipeline with stages, multiple reminders, a cart (an offer is one product, bought or not), guest checkout for strangers (offers are personal), and a public shop. Each of these would add screens and remove clarity; none makes the one decision easier.

### What this changes in the PRs

- PR 1: the Šodien screen replaces the dashboard as the entry page; Pārskats becomes a section inside Statistika.
- PR 2: the consent line in the save confirmation (heart tap) and the wishlist.
- PR 3: sign-in through the offer link; the single-screen checkout with the delivery promise, the parcel-locker option for small appliances and the carry-in question for large ones; the receipt-style order page; the seven-day "Viss kārtībā?" e-mail.
- PR 4: the paid-to-sent ratio and the lost-parcel list on Šodien.

## 12. As built (24 Oct 2026)

All four phases are implemented in one change. Where the build differs from the text above, this section is what the code does.

**Where things are**
- Rules (pure, unit-tested): `src/domain/offers/offers.ts` (claims, VAT, margin, offer and order steps, withdrawal, late parcels, delivery promise, carriers, numbering), `src/domain/offers/checkout.ts` (order form), `src/domain/admin/stats.ts` (ranges, quartiles, answers, CSV), `src/domain/analytics/visits.ts` (cookie-less counting).
- Services: `src/services/offers/` (offers, orders and invoices, e-mails, the job, lockers, tracking, privacy), `src/services/admin/` (audit log, flags, statistics), `src/services/visits/`, `src/services/jobs/housekeeping.ts`.
- Pages: `/admin/**`; `/piedavajums/[token]` and `/pasutit`; `/konts/pasutijumi/**`; `/rekins/[id]`; `/pasutijums/[token]` (feedback); `/piedavajumi/atteikties/[token]`; `/pirkuma-noteikumi`.
- Migration `0009_admin_offers.sql`. Carriers and their tracking links are configuration: `data/carriers.json`.

**Differences from the plan**
- **Timeline:** one table, `offer_events`, serves as the offer's and the order's timeline (instead of a separate `offer_order_events`). The buyer sees only the order steps; the admin also sees sign-ins, reminders and notes.
- **Offer-link sign-in is single-use.** The first "Pieņemt" signs the recipient in for the normal session length. A second use of the same link (for example, a forwarded one) goes to the normal sign-in. The admin opening the link does not count as "opened".
- **No bank transfer** (owner decision 3). Without a payment provider, "Pieņemt" records the order as waiting for payment. The buyer sees "Maksājumu pieņemšana tiek sagatavota", and the inbox gets a note.
- **Delivered e-mail dates and the withdrawal deadline** are counted from `delivered_at`. `delivered_at` is set by the carrier, the admin ("Piegādāts") or the buyer ("Saņēmu preci"). The admin can correct it, and the correction is logged.
- **Carrier polling:** only Omniva, because it is the only carrier with a documented tracking API (`developer.omniva.ee`, Track and Trace).
  - It is on when the `OMNIVA_*` variables are set.
  - It makes at most 5 requests per run (Omniva's rate limit) and checks each parcel at most every 10 hours.
  - Omniva does not document which event means delivered. `OMNIVA_DELIVERED_EVENT_CODES` holds the codes Omniva's integration team gives; until then the event name is matched.
  - DPD and Venipak need business accounts first. Until then their parcels are marked delivered by hand or by the buyer.
- **Parcel lockers** come from Omniva's public `locations.json`, cached for a day. If the file cannot be fetched, checkout asks for the locker in words. DPD lockers need an API account and are not listed.
- **Unsubscribe:**
  - Mail clients use RFC 8058 one-click: a `POST` to `/api/offers/unsubscribe/{token}`.
  - The link in the e-mail text opens a page with one button, so link scanners cannot unsubscribe anyone.
  - Unsubscribing also cancels that person's open offers.
- **Reminder:** exactly one per offer, two days before expiry, never on the day the offer was sent, and only to people who have not accepted and are still opted in. The kill switch stops offers and reminders, not order e-mails.
- **Header:** the admin sees an "Admin" link. Every admin page and action still checks `ADMIN_EMAILS` on the server.
- **Visits:** the beacon (`/api/visit`) counts only after the page has loaded in a real browser. Bots and headless browsers are dropped before the rate limit. The Statistika table shows the top 25 pages; the CSV has all of them.

**Tests**
- Unit:
  - every rule above;
  - the full offer→order→invoice→refund flow against Postgres;
  - the job (expiry, reminder, feedback, tracking with a fake carrier);
  - statistics, visits and audit.
- E2E (`tests/e2e/admin.spec.ts`, `offers.spec.ts`, mobile-360 and desktop):
  - admin access, every section, visits and CSV, the kill switch;
  - the whole journey from the heart to the refund;
  - the single-use link sign-in, and a company buyer with a parcel locker;
  - consent withdrawal, data export and account deletion.
