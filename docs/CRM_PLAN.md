# Admin as a CRM: one worklist, a pipeline and records (plan, 30 Oct 2026)

The owner's ask: Pieprasījums, Piedāvājumi and Pasūtījumi are three tables with no dates, no product codes and no way to tell what still needs a hand. Make it work like a CRM: today's orders and their statuses on one page, a filter for what nobody has handled, a mark for what has been requested from a partner (with the partner's order id), and the EAN or model code on every row.

Owner answers, 30 Oct 2026: the partner mark carries a free partner name and the partner's order id, no fixed list; there are no time limits, an item needs attention as soon as its next step is Trilio's; the worklist is called **Uzdevumi** (the owner found "Darbs" odd).

## 1. What is there today, and what is wrong with it

| Page | Today | Gap |
| --- | --- | --- |
| Pieprasījums | Products by number of savers, one button "Piedāvāt visiem" | No code, no date, no sign that an offer was already made, no partner request mark. The Bosch at the top already has an offer out; the row looks the same as a fresh one. |
| Piedāvājumi | Offers by status | No date filter, no product code, no "waiting for the supplier" state. |
| Pasūtījumi | Orders by status, late ones highlighted | No date filter, no code, no "untouched" filter, no owner, no notes in the list. |
| Šodien | A to-do list of ships, lates, returns, problems | The right idea, too thin: it does not include leads or offers, has no filters, and does not say when something was last touched. |

The model underneath is already a pipeline, it is just shown as three unrelated tables: a saver is a lead, an offer is an opportunity, an order is a deal, and `offer_events` is the activity log.

## 2. The CRM in Trilio's words (Salesforce ideas, one person's workload)

| Salesforce | Trilio | Record |
| --- | --- | --- |
| Lead | A product people asked to hear about (`saved_items`) | Pieprasījums row |
| Opportunity with stages | An offer: Melnraksts → Nosūtīts → Atvērts → Pieņemts → Apmaksāts, or Beidzies / Atcelts | `special_offers` |
| Closed-won order with fulfilment | An order: Gaida apmaksu → Apmaksāts → Sapakots → Nosūtīts → Piegādāts, or Atteikums / Atgriezts / Atmaksāts / Atcelts | `offer_orders` |
| Activity timeline | Events (sent, opened, reminded, order, paid, invoice, note, problem) | `offer_events` |
| Task / "needs attention" | Anything whose next step is Trilio's, however long it has waited | computed |
| Account | The shopper: e-mail, saved items, offers, orders, consents | `users` |

No new concepts are invented. Two things are added to the data: the sourcing state of a product (asked from a partner or not) and a note per lead.

## 3. The screens

### 3.1 Uzdevumi (new; replaces Šodien as the admin home)

The name: these are the things to do, so the tab says so. Šodien stays as a saved view inside it ("Šodien": items dated today).

One page, one list, every open item with Trilio's next step first. Each row: kind (Pieprasījums / Piedāvājums / Pasūtījums), product name with **model code and EAN under it**, the shopper (e-mail or name), the stage as a chip, **what is waiting and since when** ("Jānosūta · 3 d."), the last note, and the one action for that stage.

Filters, all in the URL so a view can be bookmarked:

- **Datums:** Šodien / Vakar / 7 dienas / 30 dienas / no–līdz. Applies to the item's own date (saved, sent, paid), and a second toggle "pēdējā darbība" applies it to the last activity instead.
- **Stāvoklis:** Vajag rīcību (default) / Gaida klientu / Gaida partneri / Pabeigti / Visi.
- **Veids:** Pieprasījumi / Piedāvājumi / Pasūtījumi.
- **Partneris:** Nav prasīts / Prasīts / Apstiprināts / Nav pieejams (§4).
- **Kategorija** and **meklēt** (order number, e-mail, product name, model code, EAN).

Saved views as links at the top: "Šodien", "Nav apstrādāti", "Prasīts partnerim", "Gaida klientu". Counts on each. The default sort is the longest-waiting first, so the age column ("3 d.") does the work a limit would have done without hiding anything.

The to-do items Šodien shows today (ship, late, returns, problems, ingestion failures) are rows here with the filter "Vajag rīcību".

### 3.2 Pieprasījums, Piedāvājumi, Pasūtījumi (kept, upgraded)

Each list gets the same bar as Uzdevumi (date, status, partner, category, search) and the same row anatomy: code and EAN under the name, the date column, the last activity, the partner state. Sorting by any column. Up to 50 rows a page, with "vēl" below. CSV of the filtered view, not of everything.

Pieprasījums rows also show: how many of the savers already got an offer and what it did ("3 saglabāja · 1 piedāvāts · 0 nopirkts"), so a row with an offer out is not offered again by mistake, and the partner state with the one-tap mark (§4).

### 3.3 The record pages (offer, order)

Exist today. Add at the top of each: the product line with code and EAN and the shop's current price; the partner block (§4); the owner's notes with a date; and the timeline from `offer_events` shown as a vertical list with who did what (admin e-mail, "sistēma", "pircējs"). Add "Nākamais solis" at the top with the one button for it.

### 3.4 The shopper (account) page in the admin

Lietotāji → one person: e-mail, language, consents with dates and the consent text version, saved items, offers, orders, in one place. It exists in parts; this makes it one page with the timeline.

## 4. "Prasīts partnerim": the sourcing state

A product is sourced once, not per shopper, so the state lives on the product, in a new table `product_sourcing` (product_id, status, partner, partner_order_ref, requested_at, answered_at, cost_cents, note, updated_by). Statuses: `not_requested` (no row), `requested`, `confirmed` (with the cost, which pre-fills the offer form), `unavailable`.

One tap on any row: "Atzīmēt: prasīts partnerim" opens a sheet with three free fields: partner (text, remembered as a suggestion from earlier entries, no fixed list), **partnera pasūtījuma nr.** and a note. Later taps move it to confirmed (asks for the cost) or unavailable. The chip shows the state and the order id ("Prasīts · Euronics #48213"); the id is searchable in every list. The state is a chip on every row of the product, in all three lists and in Uzdevumi, and a filter everywhere.

An offer made while the product is `requested` shows "Gaida partneri" in Uzdevumi; when the partner confirms, the row moves to "Vajag rīcību: nosūtīt".

## 5. "Nav apstrādāts": the attention rule

No time limits (owner, 30 Oct 2026). An item needs attention the moment its next step is Trilio's; the list shows how long it has waited and sorts the oldest first. The rules are code, in one table, so the owner can read them:

| Item and stage | Trilio's turn when | Next step shown |
| --- | --- | --- |
| Lead, nobody offered | savers ≥ 1 and no open or paid offer for that product | Prasīt partnerim / Piedāvāt |
| Lead, partner requested | no answer recorded | Atzīmēt partnera atbildi |
| Lead, partner confirmed | no offer sent since | Piedāvāt |
| Offer, draft | not sent | Nosūtīt |
| Offer, sent or opened | nothing: the shopper's turn ("Gaida klientu"); the reminder is automatic | — |
| Offer, accepted, awaiting payment | nothing: the shopper's turn | — |
| Order, paid | not packed | Sapakot |
| Order, packed | not shipped | Nosūtīt |
| Order, shipped | the carrier shows no movement past its promise (`isLate`, as today) | Pārbaudīt sūtījumu |
| Order, return requested | not contacted | Sazināties |
| Order, problem reported | not resolved | Atrisināt |

"Pēdējā darbība" is the newest `offer_events` row by an admin, or the lead's newest save. A note counts as an action and records the date, but it does not clear the flag: only the next step does.

## 6. Data and code

- **Schema:** `product_sourcing` (§4); `lead_notes` (product_id, note, created_by, created_at) for Pieprasījums; an index on `offer_events (offer_id, created_at)`. Nothing else: dates, codes and EANs already exist.
- **Domain (pure, tested):** `src/domain/admin/crm.ts`: the stage of each item, `nextStep(item)`, `needsAttention(item)` with the table in §5, `waitingSince`, and the filter parser (dates in Riga time).
- **Services:** `src/services/admin/crm.ts`: one query per kind that returns a common `WorkItem` shape (kind, id, product {name, modelCode, ean}, person, stage, date, lastActivityAt, sourcing, amount), with the filters applied in SQL and the attention rule applied in code on the page of results; search by EAN/model/number/e-mail with one index-backed `ilike` each.
- **UI:** one `WorkList` component (the bar, the table, the saved views, paging) used by Uzdevumi and the three lists; a `SourcingChip` with its sheet; a `Timeline`. The existing `Table`, `FilterLinks`, `Chip` stay.
- **Actions:** mark sourcing, add a note, and the existing status moves; every one writes an `offer_events` or `lead_notes` row and the audit log, as today.
- **CSV:** the filtered view, same columns as on screen, plus code and EAN.

## 7. PRs

1. **Codes and dates everywhere.** Model code and EAN under every product name; a date column; the filter bar with dates and search on the three lists; paging; CSV of the filtered view. Small, visible at once.
2. **Sourcing state.** `product_sourcing` with the partner order id, the chip, the sheet, the filter, search by the partner's id, the pre-filled cost in the offer form; Pieprasījums shows offered/bought counts.
3. **Uzdevumi.** The attention rules, the common `WorkItem`, the one list with saved views; Šodien becomes Uzdevumi; the admin home opens it.
4. **Records.** Timeline, notes and "Nākamais solis" on the offer and order pages; the one-person page.

Each PR has unit tests for the domain rules, service tests against Postgres, and e2e for the list filters, the sourcing mark with its order id and the Uzdevumi default view, on mobile-360 and desktop with axe.

## 8. Not in scope

A sales forecast, deal values on a board, assignment to several owners (there is one), e-mail integration beyond what is sent today, and a separate CRM product. The point is one list that says what to do next, and the facts (code, EAN, date, partner) on every row.

## 9. Decided

1. Partner: free text plus the partner's order id; no list.
2. No time limits; oldest-waiting first.
3. The worklist is "Uzdevumi" and replaces Šodien, which becomes a view inside it.

Ready to build, PR 1 first.
