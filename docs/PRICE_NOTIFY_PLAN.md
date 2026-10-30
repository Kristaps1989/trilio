# From "Saglabāt" to "Paziņot, kad cena samazināsies" (plan, 30 Oct 2026)

Why nobody saves: the site tells one promise (three best picks) and keeps the second (Trilio can get the same product for less) behind three gates: a button with no stated reward, an account, and a second question. This plan states the second promise on the card, makes the ask one tap with no account, folds the two e-mail consents into one plainly worded yes, and removes the last traces of the paid notification plan.

## 0. Owner decisions recorded

1. **Home promise** (owner, 30 Oct 2026): "Izvērtēsim trīs piemērotākos produktus un paziņosim, kad cena samazināsies!"
2. **Price notifications are free, with no subscription** (owner, 30 Oct 2026). The paid plan retired on 24 Oct (docs/TRUST_POLISH_PLAN.md §1) stays retired, and what remains of it in code, copy and data is removed (§4).
3. **Honesty rules hold** (CLAUDE.md rule 4). Trilio promises to tell, never promises a drop: "paziņosim, kad" names what the e-mail does; no line may say the price will fall. No countdowns, no pre-ticked boxes, no pop-ups on exit.

## 1. What the shopper sees today (360 px, signed out)

- Home: "Pastāsti, kas tev vajadzīgs. Trīs labākos variantus atradīsim mēs." Nothing about prices after today.
- Card: price, delivery, "Pirkt — Veikals A" (dark, primary), then a pale "Saglabāt". The only hint of a reward is "Cenu vēsture vēl krājas — vēlmju sarakstā to redzēsi", which describes a list, not a benefit. The sentence "Trilio iepērk tieši no izplatītāja un piegādā pats" exists only inside an offer e-mail the shopper will never receive without saving.
- Tap on "Saglabāt": a page headed "Ienākt. Konts vajadzīgs, lai vēlmju sarakstu redzētu no jebkuras ierīces." The product is gone from the screen.
- After sign-in and the save: a second box, "Vai drīkstam reizēm piedāvāt pašu izdevīgāku cenu?", with "Nē, paldies" as large as "Jā, sūtiet".
- The "Saglabā šo meklējumu" box sits at 7 600 px of an 8 400 px page and still says "par {price}/mēn. paziņosim".

With roughly ninety search-ad visitors, a funnel of this shape yields fewer than one save. Zero is the expected result of the design, not a verdict on the visitors.

## 2. The path after this plan

1. **Home** says both promises in the first sentence.
2. **Card** says, under the price and only where Trilio sources: "Trilio var piedāvāt lētāk: iepērkam tieši no izplatītāja un piegādājam paši."
3. **Button** says the outcome: "Paziņot, kad cena samazināsies". "Pirkt — {veikals}" stays first and dark.
4. **One tap, no account.** The button opens one field on the card, "Uz kādu e-pastu paziņot?", with one sentence that says exactly what will be sent, and one button, "Jā, paziņojiet". Signed-in shoppers skip the field: the tap saves and the card says "Paziņosim uz {email}, kad cena samazināsies."
5. **One confirmation e-mail** (branded shell, docs/ADMIN_AND_OFFERS_PLAN.md §11.1). Its one link confirms the address, creates the account silently, saves the product and switches both notifications on. Nothing is sent to an unconfirmed address.
6. **Wishlist** stays the place to see saved products, price history and to stop the e-mails. One panel, "Cenu paziņojumi", free. No plan, no price, no threshold.

## 3. Copy (Latvian first; English goes to en.json in the same PR)

The owner reviews every Latvian line before it ships. Keys are proposals.

### Home

| Key | Latvian |
| --- | --- |
| `home.heroTitle` | Pastāsti, kas tev vajadzīgs. |
| `home.heroSub` | Izvērtēsim trīs piemērotākos produktus un paziņosim, kad cena samazināsies! |

The owner's line is the subtitle: as a second sentence of the h1 it would run to five lines at 360 px. Owner to confirm the split.

### Results card

| Key | Latvian | When |
| --- | --- | --- |
| `results.trilioCanOffer` | Trilio var piedāvāt lētāk: iepērkam tieši no izplatītāja un piegādājam paši. | Only in subcategories listed in `data/offers.json` (§5, PR 1). |
| `wishlist.notify` | Paziņot, kad cena samazināsies | Button, product, not saved |
| `wishlist.notifying` | Paziņosim, kad cena samazināsies | Button, product, saved |
| `wishlist.notifySearch` | Paziņot, kad parādīsies lētāks variants | Button, search, not saved |
| `wishlist.notifyingSearch` | Paziņosim par lētākiem variantiem | Button, search, saved |
| `wishlist.notifyNote` | Paziņosim uz {email}, kad cena samazināsies. | Under the button, signed in |
| `wishlist.alertStop` / `alertResume` | Nesūtīt / Tomēr sūtīt | Unchanged |

### The one field (signed out)

| Key | Latvian |
| --- | --- |
| `notify.title` | Uz kādu e-pastu paziņot? |
| `notify.body` | Uzrakstīsim, kad šīs preces cena veikalos samazināsies vai kad Trilio to varēs piedāvāt lētāk nekā veikali. Tikai par šo preci, ne biežāk kā reizi dienā. Atteikties var jebkurā brīdī. |
| `notify.email` | E-pasts |
| `notify.submit` | Jā, paziņojiet |
| `notify.sent` | Nosūtījām apstiprinājuma saiti uz {email}. Atver to, un paziņosim, kad cena samazināsies. |
| `notify.invalid` | Lūdzu, ievadi derīgu e-pasta adresi. |
| `notify.tooMany` | Pārāk daudz pieprasījumu. Mēģini vēlreiz pēc stundas. |

For a saved search the body reads: "Uzrakstīsim, kad šajā meklējumā parādīsies lētāks variants vai kad Trilio kādu no tiem varēs piedāvāt lētāk nekā veikali. Ne biežāk kā reizi dienā. Atteikties var jebkurā brīdī."

### Confirmation e-mail

| Key | Latvian |
| --- | --- |
| `notifyEmail.subject` | Apstiprini cenas paziņojumus: {product} |
| `notifyEmail.body` | Sveiki! Tu lūdzi paziņot, kad samazināsies šīs preces cena: {product}, šobrīd {price}. Apstiprini ar vienu klikšķi, un viss būs gatavs. |
| `notifyEmail.button` | Apstiprināt |
| `notifyEmail.notYou` | Ja tas nebiji tu, nekas nav jādara: bez apstiprinājuma neko nesūtīsim. |

### Wishlist page

| Key | Latvian |
| --- | --- |
| `wishlist.notifyTitle` | Cenu paziņojumi |
| `wishlist.alertsOn` | Bez maksas. Sūtām uz {email} ne biežāk kā reizi dienā, tikai par cenu kritumiem un Trilio piedāvājumiem. |
| `wishlist.alertsOff` | Cenu paziņojumus nesūtām. Saglabātās preces un cenu vēsture darbojas arī bez tiem. |
| `wishlist.empty` | Vēl nekas nav saglabāts. Spied „Paziņot, kad cena samazināsies” pie preces. |

### The box after the three picks (replaces "Saglabā šo meklējumu" at the bottom)

| Key | Latvian |
| --- | --- |
| `results.notifySearchTitle` | Paziņot, kad šajā meklējumā parādīsies lētāks variants? |
| `results.notifySearchSub` | Viens e-pasts, ne biežāk kā reizi dienā. |

Removed keys (paid plan): `results.saveSub`, `results.radarMonthly`, `wishlist.notifyCta`, `notifyOffTitle`, `notifyOffBody`, `planTitle`, `planKicker`, `legalNote`, `subscribe`, `feature1`, `feature2`, `paymentsOff`, `waitlist*`, `cancelConfirm`, `expired`, `sendTo`, `subscription`, `thresholdTitle` and the threshold options.

## 4. Removing the paid plan for good

Retired on 24 Oct, still present in: `velmju-saraksts/SubscriptionPanel.tsx`, `ThresholdPicker.tsx`, `pazinojumi/`, `apmaksats/`, `atcelts/`, `services/billing/*`, `api/cron/billing`, the `subscriptions`, `plans` and digest-threshold tables, `STRIPE_*` keys, docs/PAYMENTS.md and docs/PRODUCT_SPEC.md §5. Payments stay for offer orders only (one-off, docs/ADMIN_AND_OFFERS_PLAN.md); task #31 (Paysera) is scoped to orders.

Steps: cancel any active subscription at period end and e-mail those users that notifications are now free (none are expected; the admin shows the count first); delete the UI and the billing job; drop the tables in a migration after the accounting CSV export has a copy; remove the env keys from `.env.example` and Railway. Threshold goes: every drop is reported, debounced to one e-mail a day as today.

## 5. Engineering

### PR 1: say it (copy, card line, button, box, paid remnants)

- Messages per §3 in lv.json and en.json; the parity test keeps them aligned.
- `data/offers.json`: `{ "sourcing": ["fridge", "freezer", …] }`, the subcategories where Trilio actually buys from a distributor. The card line and the "Trilio piedāvājumi" half of the consent text appear only there. Owner supplies the list.
- Results page: the box moves to directly under the three picks, one line and one button; the bottom box goes.
- Wishlist page: remove the subscription panel and the threshold picker (§4, UI part only).
- e2e: card shows the line only in sourcing categories; the button text; the box position (above "Citi varianti"); axe.

### PR 2: one tap, no account

- Table `notify_requests`: id, email, target (product id or subcategory + answers), locale, consent text version (the exact `notify.body` key version shown), status requested/confirmed, created_at, confirmed_at, visitor hash of the day, ad_landing_id (attribution as for saves), honeypot flag.
- Server action `requestNotifyAction(target, email)`: validate, rate-limit per visitor hash (5 per day) and per e-mail (3 per day), store the request, send the confirmation e-mail. The link is the existing Auth.js magic link whose callback is the existing `/velmju-saraksts/pievienot` with the target, plus `notify=<request id>`; on arrival that route saves the item, sets `priceAlerts` on and `offersOptIn` with `offersOptInAt` and the consent version, and marks the request confirmed. Nothing is sent to the address before that click.
- Signed-in tap: today's behaviour, with the new note. `OffersAsk` is replaced by the single text in `notify.body`; the "Nē, paldies" path becomes the "Nesūtīt" link that already exists.
- The confirmation e-mail uses the branded shell from PR #51 and the same one-click List-Unsubscribe headers as the digest.
- Unit tests: validation, rate limits, consent version stored, nothing sent twice. Integration: request → confirm → saved item with both flags → digest goes out on a drop. e2e: signed-out tap shows the field, submit shows `notify.sent`, the mock inbox has one e-mail, its link lands on the results page with the card in the "Paziņosim" state.

### PR 3: measure the gates without cookies

- First-party events table `ui_events` (day, visitor hash, event, subcategory): `notify_tap`, `notify_shown`, `notify_sent`, `notify_confirmed`, `shop_click`. Recorded server-side like visits; no cookie.
- Admin → Statistika gets "Ceļš līdz paziņojumam": results visitors → taps → e-mails entered → confirmed → shop clicks, per category and per ad campaign (join on `ad_landings` as the Reklāma overview does).
- A read-only SQL in docs/RUNBOOK.md for the same funnel, for days when the admin is not enough.

### PR 4: delete the paid plan (code and data)

§4 in full: billing service, cron route, tables, env keys, docs. After PR 1 so the UI is already gone.

## 6. Law and honesty

- Price-drop e-mails about a product the person asked about are a service message; Trilio's own offers are a commercial communication (Information Society Services Law art. 9, GDPR). One yes covers both only because the sentence above the button names both plainly and the button itself is the affirmative act. The exact text and its version are stored with the request. The lawyer confirms the wording once before PR 2 ships.
- Double opt-in: nothing goes to an address until its owner clicks the confirmation link. This protects strangers whose address someone typed, and it is what the magic link already does.
- Every e-mail keeps one-click unsubscribe (RFC 8058) and the "Nesūtīt" link in the wishlist.
- No "cena kritīs", no "tikai šodien", no pre-ticked boxes, no pop-up on leaving the page, no interstitial on the way to the shop. The shop button stays first and unchanged.

## 7. Open points for the owner

1. The hero split (title "Pastāsti, kas tev vajadzīgs.", subtitle the owner's line) or the whole line as the title.
2. The list of subcategories where Trilio sources from a distributor, for `data/offers.json`.
3. Whether the threshold picker ("par kādiem kritumiem ziņot") stays as a free setting or goes. Recommendation: goes; one e-mail a day about any drop is simpler to explain.
4. Confirmation that no active paid subscriptions exist before PR 4 drops the tables (the admin shows the count).
