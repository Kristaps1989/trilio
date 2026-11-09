# One proposal without confirming the e-mail (plan, 9 Nov 2026)

Owner's ask (9 Nov 2026): "Some people have left an e-mail but have not approved it.
Maybe by entering the e-mail the user agrees to receive a proposal, to simplify the
process while Trilio is a new brand. Perfect if I could see the products and still
send a proposal to those users."

## 1. Assessment

**Allowed, with a narrow scope.** A shopper who presses „Iegūt lētāk" on a product and
types an e-mail is asking Trilio for a price on that product. One reply with that price
is the answer to their own request: a step before a possible purchase, at their request
(GDPR art. 6(1)(b)), not a commercial communication sent unasked (Information Society
Services Law art. 9). It needs no separate consent and no confirmation click.

What it does **not** cover:

- **Price-drop e-mails and other offers.** They are ongoing messages, so they still
  start only after the confirmation click (double opt-in), as today.
- **Requests made before this change.** The form said „Pēc apstiprināšanas sāksim meklēt
  zemāku cenu", and the privacy notice said „Kamēr neapstiprini, citus e-pastus
  nesūtām". Those people were promised nothing before confirming. Their products show as
  demand in the admin, but they cannot be sent a proposal. Their requests are deleted
  after 7 days as the notice says.
- **Searches and categories Trilio does not source.** The text there never mentioned a
  proposal.

**The one risk** is that a typed address belongs to someone else (a typo or a prank). The
answer is one message only, saying plainly why it came: „Šo piedāvājumu sūtām, jo
{datums} trilio.lv pieprasīji zemāku cenu šai precei. Ja to neprasīji tu, šo e-pastu
ignorē: vairāk nerakstīsim." There are no reminders and no follow-ups until the address
is confirmed. The existing rate limits stay: 3 a day per address, 5 per visitor.

**The lawyer's answer (9 Nov 2026):** no extra approval is needed to send the
information; by entering the e-mail the person consents. But the person must always be
able to unsubscribe. So the proposal carries an unsubscribe link (and the one-click
List-Unsubscribe header). For an unconfirmed request it deletes the request and cancels
its open proposal: nothing more goes to that address, and its confirmation link stops
working.

## 2. What changes

**Shopper**

- The form text names the proposal and the address. Consent version `2026-11-09`:
  „Pajautāsim izplatītājam un 2 darba dienu laikā atsūtīsim piedāvājumu par šo preci uz šo
  e-pastu. Ja apstiprināsi adresi, sekosim arī cenai…" A signed-in shopper's address is
  already proven, so their text drops the „Ja apstiprināsi adresi" clause.
- After sending: „Paldies! Piedāvājumu atsūtīsim uz {email} 2 darba dienu laikā. Lai pēc
  tam sekotu arī cenai, apstiprini adresi saitē, ko nosūtījām."
- The confirmation e-mail is now „Pieprasījums saņemts". The proposal comes either way;
  the button switches on price tracking.
- The proposal e-mail to an unconfirmed address:
  - carries the reason line above;
  - has a „Sekot cenai" button, which is the confirmation link;
  - has an unsubscribe link, „Atteikties no piedāvājumiem", which deletes the request
    (lawyer, 9 Nov 2026); the page says no account is needed.
- To order, the person signs in with that e-mail (a magic link, which proves the address).
  The offer is then theirs. Confirming the request attaches the offer to their account too.

**Admin**

- **Pieprasījums:**
  - unconfirmed requests count as demand next to saves;
  - a product asked for only by unconfirmed requests now appears in the list.
- **The product's page:**
  - a section „Neapstiprināti pieprasījumi" lists the e-mail, date, days left, and whether
    a proposal can go (or why not);
  - „Piedāvāt visiem" includes the requests that can receive one.
- **New proposal:** requests sit beside saved users in the recipient list.
- **Sending:**
  - one proposal per request;
  - only while the request is kept (7 days);
  - the proposal keeps the address for its own life;
  - no reminder e-mail for it.

**Privacy notice:** the request item and the retention item say exactly this.

## 3. Data

- `special_offers.notify_request_id` (set null when the request is purged) and
  `special_offers.email` (the address for an offer without an account).
- `requestOfferable(request)` in `domain/notify/notify.ts`:
  - a product;
  - Trilio's offers covered by the text shown;
  - consent version `2026-11-09` or later;
  - not confirmed;
  - not older than 7 days.

## 4. Tests

- **Domain:** what is offerable (old version no, search no, plain category no, confirmed
  no, expired no).
- **Service:**
  - drafting for a request;
  - one per request;
  - send without an account;
  - the e-mail's reason line and its unsubscribe link and header;
  - unsubscribing deletes the request and cancels the open proposal;
  - no reminder;
  - confirming attaches the offer;
  - ordering by the same address after sign-in, refused for another.
- **e2e:**
  - request without confirming;
  - the admin sees it under the product;
  - drafts and sends;
  - the mock inbox has the proposal;
  - the offer page lets that address order after sign-in.
