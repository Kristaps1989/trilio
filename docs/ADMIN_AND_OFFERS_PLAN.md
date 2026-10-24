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
3. **Accept:** "Pieņemt piedāvājumu" requires signing in as the recipient (magic link to the same address; Google if they used it). This ties the order to the account, keeps a leaked link harmless, and makes the order appear under "Mani pasūtījumi". Then **one form**: name, phone, e-mail (prefilled from the account), street, city, postcode (validated `LV-dddd`), optional delivery note; a line "Piegāde Latvijā: bez maksas · līdz {date}"; the price; a checkbox agreeing to the purchase terms and acknowledging the 14-day withdrawal right (the legally required wording, no pre-ticked boxes); the button "Apmaksāt {price} €". A second checkbox for refurbished goods confirms the grade was understood.
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

## 8. Owner decisions before PR 3

1. Seller details for invoices and purchase terms (`COMPANY_*` variables exist; VAT registration status decides the invoice layout).
2. Return shipping: paid by Trilio (recommended) or the shopper.
3. Warranty handling: Trilio forwards to the distributor, or the distributor's service network directly.
4. Bank-transfer payments allowed before Paysera goes live? (Recommended yes; manual, audited.)
5. Reminder before expiry: one, only if never opened (recommended), or none.
6. First-party visit counting (cookie-less, 35-day raw retention) is acceptable in the privacy policy.
