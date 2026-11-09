# Entering the e-mail is the consent; price e-mails run 90 days (9 Nov 2026)

## Decisions (owner and lawyer, 9 Nov 2026)

- **No extra approval.** By entering the e-mail at „Iegūt lētāk", the person consents.
  The proposal and the price e-mails start at once. There is no confirmation click
  (this replaces the double opt-in in docs/PRICE_NOTIFY_PLAN.md §6).
- **Always an unsubscribe.** Every e-mail has one: the receipt, the price e-mails,
  the proposal and the renewal question. Each also carries the one-click
  List-Unsubscribe header.
- **90 days, then ask.** Price e-mails run 90 days from the request, or from the last
  renewal. Seven days before the end, one e-mail asks whether to continue for another
  90 days. Without an answer, the request is deleted.

## What happens

1. **The shopper** types an e-mail and presses „Sūtīt pieprasījumu".
   - The form says what will come: a proposal within 2 working days, where Trilio
     sources; price e-mails at most once a day, for 90 days; and that they can stop
     at any time.
   - This is consent version `2026-11-09.2`.
2. **The request starts at once** (`activateRequest` in `services/notify/requests.ts`).
   - An account for that address is created if there is none. Its address is not yet
     proven (`emailVerified` stays empty, nobody is signed in).
   - The product or search is saved to its wishlist, with today's price as the
     baseline.
   - Trilio's offers are turned on where the text covered them and the person never
     answered that question before.
   - A switch the person turned off earlier stays off. The receipt says so, and its
     button turns it back on.
3. **The receipt** („Pieprasījums saņemts" / „Sekosim cenai") says:
   - what was asked;
   - that it has started, for 90 days;
   - „Atvērt vēlmju sarakstu", the old confirmation link, which now proves the address
     and signs the person in once;
   - „Ja to neprasīji tu, atsakies, un vairāk nerakstīsim", with the unsubscribe link.
4. **The admin** sees the person as a saver who accepts offers, and offers the usual
   way from the user's page. „Neapstiprināti pieprasījumi" now only lists requests
   made under the older texts (docs/REQUEST_OFFER_PLAN.md).
5. **The 90 days** (`runAlertRenewals` in `services/wishlist/alerts.ts`, run daily
   by housekeeping):
   - **7 days before the end:** one e-mail per person, „Vai turpināt sekot cenai?".
     It lists the items and has a „Turpināt vēl 90 dienas" button
     (`/velmju-saraksts/turpinat/{token}`, a page with one button, so a mail scanner
     cannot renew), plus an unsubscribe.
   - **At the end, unrenewed:** the price e-mails for those items stop.
     - **Never signed in:** the items are deleted. The account goes too once nothing
       is left (no saves, proposals or orders).
     - **Signed in** (magic link, Google, the offer or receipt link): the items stay in
       the wishlist without e-mails.
   - **Saving the same thing again** starts a fresh 90 days.
6. **Unsubscribe** from a price, receipt or renewal e-mail:
   - **For an address never signed in:** it stops everything. Price e-mails and
     Trilio's offers go off, open proposals are cancelled, and the saved items and
     requests are deleted. The page says „Tavu pieprasījumu dzēsām".
   - **For a signed-in account:** only the price e-mails stop. The wishlist stays.

## Data

- `saved_items.alerts_until` (default now + 90 days) and `saved_items.renewal_sent_at`.
  Existing saves got 90 days from the migration (0028), so nothing stops suddenly.
- `notify_requests.activated_at`: the request started the price e-mails.
  - Activated requests are the record of consent. They are not purged after 7 days;
    they go with their account.
  - Requests that started nothing still go after 7 days.

## Older requests

- **Before 9 Nov 2026:** the text promised nothing before the click. Those requests
  are never activated and are deleted after 7 days.
- **Made on 9 Nov under `2026-11-09`:** the text said a proposal comes without
  confirming, and price e-mails only after the click. They keep exactly that
  (docs/REQUEST_OFFER_PLAN.md).

## Tests

- `domain/notify/notify.test.ts`: which text starts at once; the 90-day phases.
- `services/notify/requests.test.ts`:
  - the request makes the account and saves;
  - the receipt has an unsubscribe;
  - a switch turned off stays off, and the button turns it on;
  - the purge keeps activated requests.
- `services/wishlist/renewals.test.ts`:
  - asks once, 7 days before the end;
  - renewal gives 90 days;
  - expiry deletes an unproven request and its account;
  - a proven account keeps its items without e-mails;
  - the unsubscribe stops everything only for an unproven address.
- e2e:
  - `request-offer.spec.ts`: a request with no click becomes a saver who accepts
    offers; the proposal; ordering; a stranger unsubscribing from the receipt.
  - `wishlist.spec.ts`: the receipt and its link.
  - `a11y.spec.ts`: the renewal page.
