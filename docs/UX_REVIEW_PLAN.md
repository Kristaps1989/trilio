# UX review: does a visitor understand Trilio and give it an e-mail?

Owner's ask (8 Nov 2026): visitors do not leave an e-mail with „Iegūt lētāk”.
An independent review of the UI and UX: does a visitor understand what Trilio
does and what it is worth to them? Then (same day): "I approve all, follow
global best practice, implement and test e2e. Currently I have only one actual
case where a user saved 50 €, maybe this can be smart implemented, just cannot
show personal data."

Status: **built (8 Nov 2026).**

## Findings (the review, short)

1. The cookie banner covered the lower 40 % of every phone screen, on every page, before anything else.
2. The home headline („Pastāsti, kas tev vajadzīgs.”) was an instruction, not a promise; the three
   things the TV spot sells (choice, compared prices, we ask for a lower price) were not on the first screen.
3. Fridges without a budget showed three Mieles from 1 299 € to 2 759 €: honest, but it reads "not for me".
4. The card read like a spec sheet (model code and EAN under the name, "price history is still collecting"),
   and its two buttons weighed the same; „Iegūt lētāk” said nothing about what it does or is worth.
5. „Iegūt lētāk” took three taps with the same label before an e-mail field, its first step was
   „Tu atstāj e-pastu”, the caveat sat under the call to action, and nobody was named.
6. Nothing showed that it had worked before.

## What changed

### 1. A cookie bar, not a panel
Two short lines at the bottom (`[data-consent-bar]`): who (Google and Meta), what for, that the site
works without, a link to /sikdatnes, and two equal buttons. Informed consent with equal choices
(GDPR, CLAUDE.md rule 4); the full explanation stays on /sikdatnes.

### 2. The home page says the promise
Headline „Trīs labākās preces tev — un zemāka cena, ja to varam panākt.”, a lead with the mechanism
(compare by barcode, ask the distributor, free), one lime action „Palīdzi izvēlēties”, the model check
as a plain link, and the proof line (§6) when there is one.

### 3. One-screen „Iegūt lētāk”
The question before the shop (sheet, and /pirms-veikala) and the card's own panel now show, in order:
the saving in euro, a promise line („Piedāvājumu atsūtīsim 2 darba dienu laikā. Ja zemāku cenu nepanāksim,
turpināsim sekot cenai un paziņosim, kad tā samazināsies. Bez maksas · pirkt nav obligāti.”; owner, 8 Nov 2026:
the offer within 2 working days, and without one the price watch goes on),
who handles it (`OFFERS_SENDER_NAME`), the proof (§6), then the e-mail field **at once** (signed out) or
one button (signed in), the three steps and the caveat folded under „Kā tas strādā?”, and the shop as
a second, outlined button. The e-mail button says what it does: „Sūtīt pieprasījumu”.

### 4. The card
- The lime „Iegūt lētāk” carries its worth: „līdz −129 €” (10 % of the price, whole euros), as the
  button's description so its name stays „Iegūt lētāk”.
- „Pirkt — {shop}” is outlined: the second choice, still full width and visible.
- The model code and EAN move from under the name to a small line above the buttons (they are the
  same-product proof, CLAUDE.md rule 3); „Cenu vēsture vēl krājas” is gone.

### 5. Without a budget: the usual range, several brands
`rank()` picks within the 75th percentile when no upper limit is given (the rule the category pages
already use), and within each price third prefers a brand not yet picked, only where that product still
earns its price (`earnsPrice`). With the review's fridge line-up: before, three Mieles up to 3 000 €;
after, a Bosch and two Mieles under 850 €.

### 6. Anonymous proof
`loadSavingsProof` takes paid Trilio offers (paid, packed, shipped, delivered) and their saving against
the shop price frozen in the offer (`referencePriceCents − priceCents`, times the quantity), plus savings
the owner records by hand in `data/savings.json` (category, euros, month) for cases outside the offer flow.
Each saving is rounded to the nearest euro (49,99 € shows as 50 €). The first recorded case (owner, 8 Nov 2026):
a fridge at 719,99 € in the shop, offered by Trilio for 670 € with free delivery, in `data/savings.json`.
Shown only as category, amount and month, e.g. „Reāls piemērs: novembrī ledusskapis pircējam izmaksāja
par 50 € mazāk nekā veikalā.”; with more than one, the count and total. Never a name, product, shop,
date or place. Nothing is shown until there is a saving of at least 1 €.

## Tests

- Unit: `rank.test.ts` (no-budget ceiling, an explicit limit kept, brand preference),
  `proof.test.ts` (saving, rounding, latest first, nothing without a saving).
- e2e `ux.spec.ts`: the bar's height, content and equal buttons, axe; the home headline and one
  primary action; the card's euro description and outlined shop link; a seeded paid offer shows on the
  home page and in the sheet without the buyer's name, the product or the shop.
- Updated: `wishlist.spec.ts` (one-screen sheet, steps folded), `clicks.spec.ts`, `welcome.spec.ts`,
  and the panel button „Sūtīt pieprasījumu” in five specs.

## Measure

Two weeks after the deploy, with the bot filter in place (docs/CLICK_QUALITY_PLAN.md): results views →
sheet opened → e-mail sent → confirmed, in Statistika's „Ceļš līdz paziņojumam”.

## 9. The request form after the panel (14 Nov 2026)

Evidence: in 30 days 271 people saw results, 28 tapped "Iegūt lētāk", 25 saw the
form and 2 sent it; 6 went to the shop from the form. A simulated panel of 100
shoppers (built from Latvian demographics and Trilio's traffic mix, walked
through the live screens) gave the reasons; it is a source of reasons, not of
rates, since it was about four times more willing than real visitors.

What changed:

1. **The field first.** After the tap the card shows the saving, then the
   e-mail field at once; the promise, the proof and the steps follow it. The
   form scrolls into view, clear of the cookie bar.
2. **Who sells.** One line under the form: the seller is Trilio, 2-year
   warranty, 14-day withdrawal, delivery across Latvia, and what the e-mail is
   used for, with a link to the purchase terms. It states only what
   `/pirkuma-noteikumi` promises; change both together.
3. **Under 200 € the button is the price alert** (`worthAsking`,
   `OFFER_ASK_MIN_PRICE_CENTS`): at most 10 % of a kettle is not worth a
   request, and nobody asked for one. The consent stored for such a product is
   the plain price-alert text, on the card, the question before the shop, the
   wishlist and the server alike. The line above the picks shows only when a
   pick asks.
4. **"Kas atturēja no pieprasījuma?"** One optional question when the form is
   closed unsent, once per card, four answers (needs it sooner, unclear who
   sells, saving too small, only looking). Stored as `ask_why_<reason>` in
   `ui_events` with the day's anonymous visitor hash; shown in Admin →
   Statistika and in `/api/stats/site` (`askWhy`).

Not done, owner's decisions: a faster answer than two working days (the most
common reason among urgent buyers), and one request for a whole shortlist.
