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
4. **One tap, no account.** The button opens one field on the card, "Uz kādu e-pastu paziņot?", with one sentence that says exactly what will be sent, and one button, "Paziņot man". Signed-in shoppers skip the field: the tap saves and the card says "Paziņosim uz {email}, kad cena samazināsies."
5. **One confirmation e-mail** (branded shell, docs/ADMIN_AND_OFFERS_PLAN.md §11.1). Its one link confirms the address, creates the account silently, saves the product and switches both notifications on. Nothing is sent to an unconfirmed address.
6. **Wishlist** stays the place to see saved products, price history and to stop the e-mails. One panel, "Cenu paziņojumi", free. No plan, no price, no threshold.

## 3. Copy (Latvian first; English goes to en.json in the same PR)

The owner reviews every Latvian line before it ships. Keys are proposals.

**One register.** Trilio speaks to the shopper as "tu" ("Pastāsti", "Apstiprini", "Atver to"), never "jūs". Buttons are infinitives ("Paziņot man", "Apstiprināt", "Nesūtīt"), so the shopper never has to address Trilio, and no line mixes the two. The old "Jā, sūtiet" goes with the old consent box.

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
| `notify.submit` | Paziņot man |
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
- Unit tests: validation, rate limits, consent version stored, nothing sent twice. Integration: request → confirm → saved item with both flags → digest goes out on a drop. e2e: signed-out tap shows the field, tapping "Paziņot man" shows `notify.sent`, the mock inbox has one e-mail, its link lands on the results page with the card in the "Paziņosim" state.

### PR 3: measure the gates without cookies

- First-party events table `ui_events` (day, visitor hash, event, subcategory): `notify_tap`, `notify_shown`, `notify_sent`, `notify_confirmed`, `shop_click`. Recorded server-side like visits; no cookie.
- Admin → Statistika gets "Ceļš līdz paziņojumam": results visitors → taps → e-mails entered → confirmed → shop clicks, per category and per ad campaign (join on `ad_landings` as the Reklāma overview does).
- A read-only SQL in docs/RUNBOOK.md for the same funnel, for days when the admin is not enough.

### PR 4: delete the paid plan (code and data)

§4 in full: billing service, cron route, tables, env keys, docs. After PR 1 so the UI is already gone.

## 6. Law and honesty

- Price-drop e-mails about a product the person asked about are a service message; Trilio's own offers are a commercial communication (Information Society Services Law art. 9, GDPR). One yes covers both only because the sentence above the button names both plainly and the button "Paziņot man" itself is the affirmative act. The exact text and its version are stored with the request. The lawyer confirms the wording once before PR 2 ships.
- Double opt-in: nothing goes to an address until its owner clicks the confirmation link. This protects strangers whose address someone typed, and it is what the magic link already does.
- Every e-mail keeps one-click unsubscribe (RFC 8058) and the "Nesūtīt" link in the wishlist.
- No "cena kritīs", no "tikai šodien", no pre-ticked boxes, no pop-up on leaving the page, no interstitial on the way to the shop. The shop button stays first and unchanged.

## 7. Open points for the owner

1. The hero split (title "Pastāsti, kas tev vajadzīgs.", subtitle the owner's line) or the whole line as the title.
2. The list of subcategories where Trilio sources from a distributor, for `data/offers.json`.
3. Whether the threshold picker ("par kādiem kritumiem ziņot") stays as a free setting or goes. Recommendation: goes; one e-mail a day about any drop is simpler to explain.
4. Confirmation that no active paid subscriptions exist before PR 4 drops the tables (the admin shows the count).

## 8. Status (30 Oct 2026): built, waiting for the owner's review

All four PRs are built together on one branch, not merged. Choices made where the owner had not answered yet; each is one line to change:

1. **Hero:** title "Pastāsti, kas tev vajadzīgs.", the owner's line under it (`welcome.headline`, `welcome.lead`).
2. **Sourcing list:** every category (owner, 30 Oct 2026). `data/offers.json` holds `"sourcing": ["*"]`; the line "Trilio var piedāvāt lētāk…" and the offers half of the consent appear everywhere. The file can still narrow the list or leave categories out with `"except"`.
3. **Threshold:** the picker is gone. A threshold stored earlier is still honoured; everyone else gets drops of at least 5 %, the old default, so a 1-cent change sends nothing.
4. **Paid plan:** all code is gone (UI, actions, renewals, billing cron, receipts, plan seeding); `plans` rows are switched off at release. The `plans`, `subscriptions` and `notify_settings` tables stay until the owner confirms no active subscription is left (Admin → Lietotāji).

Deviation from §5: the "Trilio var piedāvāt lētāk" line is shown once, above the three picks, not on every card. Three cards saying the same sentence read as an advert; once, next to the cards, it reads as a fact.

Confirmation is a page with one "Apstiprināt" button rather than a link that confirms on opening, because mail scanners open links. It is one extra tap, made once per person.

### 8.3 The request, not the watch (owner, 31 Oct 2026)

Seen live, the owner's verdict: "Trilio var piedāvāt lētāk: iepērkam tieši no izplatītāja…" is Trilio's method, not the shopper's gain, and "Paziņot, kad cena samazināsies" still reads as a price watch; nothing on the screen says that saving makes Trilio go and find a better price. The owner suggested "Saņemt Trilio piedāvājumu"; it promises a thing that may never come, so the button names the shopper's act instead. "Lūgt" was rejected as pleading. Decided:

| Where | Now |
| --- | --- |
| Line above the picks (`results.trilioCanOffer`) | Pieprasi labāku cenu: Trilio pajautās izplatītājam un uzrakstīs, ja varēs piedāvāt lētāk nekā veikali. |
| Card button (`wishlist.notify` / `notifying`) | Pieprasīt labāku cenu → Pieprasīts · meklējam labāku cenu; a price-tag icon, the heart only in the header and the wishlist |
| Search line (`results.notifySearchTitle`, `wishlist.notifySearch`) | Unchanged in substance: Paziņot, kad šajā meklējumā parādīsies lētāks variants? → Paziņot par lētāku variantu → Paziņosim par lētāku variantu. The owner asked whether a search-level request was too much; it was also untrue, since a lead is a product and nobody can ask a partner about "a search". So the request exists only on a product; a search is a watch, saves at once, and its consent never covers offers. |
| Panel (`notify.title`, `body`, `submit`) | Uz kādu e-pastu sūtīt piedāvājumu? · Pajautāsim izplatītājam un uzrakstīsim, tiklīdz varēsim piedāvāt šo preci lētāk nekā veikali, vai kad tās cena veikalos samazināsies… · Pieprasīt labāku cenu |
| Under the card (`wishlist.alertNoteOffers`) | Meklējam labāku cenu. Uzrakstīsim uz {email}. |
| Confirmation e-mail and page | Apstiprini, un meklēsim labāku cenu · Tu pieprasīji labāku cenu… |
| Wishlist (`wishlist.sub`, `empty`) | …Visiem meklējam labāku cenu. · Spied „Pieprasīt labāku cenu” pie preces. |

The honesty guards: every promise is conditional ("ja varēsim piedāvāt lētāk"), and the price-drop e-mail stays in the same sentence, so the request always has a true outcome even when the distributor is not cheaper. The consent text changed, so `CONSENT_VERSION` is `2026-10-31`; earlier requests keep the version they were shown. Where `data/offers.json` leaves a category out, the `…Plain` and `…Drop` keys keep the old price-watch wording and the heart, because there Trilio asks nobody.

### 8.4 The question before the shop (owner, 1 Nov 2026)

Search visitors were good and nobody requested a price: a shopper who already knows the model takes the one-step path, "Pirkt — Tet", and Trilio is gone. The owner asked for a step at that moment. Built as one sheet, not a pop-up on arrival (an entry interstitial is what Google penalises on mobile and what rule 4 forbids):

- **When:** the first "Pirkt — {Shop}" click of a visit, on a product not yet requested. Middle and modifier clicks, crawlers and bots get the plain `/go/…` link as before.
- **What:** `ask.title` "Pieprasīt labāku cenu, pirms ej uz veikalu?", the product line "{name} · {price} veikalā {shop}", the conditional promise ("Ja varēsim lētāk… ja ne, paziņosim… Bez maksas, bez konta."), and **two buttons of equal size**: "Pieprasīt labāku cenu" (lime) and "Uz {Shop}" (dark). No "Nē, paldies", no countdown, no second ask. Esc, the backdrop and the close button leave without choosing. Where Trilio does not source, the sheet is the price watch (`…Plain` keys).
- **Then:** the request runs the card's own flow inside the sheet (`useRequest`: e-mail field signed out, one yes signed in), and "Uz {Shop}" stays visible under it. Any answer or dismissal is remembered for 24 hours in `localStorage.trilio_ask_shop` (a timestamp, no personal data), after which every shop link in every tab goes straight through: once per visitor, not once per click (owner, 1 Nov 2026). A product already requested never asks.
- **Measured** with the same first-party events: `ask_shown` (server action on open) and `ask_shop` (`/go/{offer}?ask=1`, recorded by the redirect for people only). Admin → Statistika → "Ceļš līdz paziņojumam" has two new columns, "Jautājums pirms veikala" and "Izvēlējās veikalu (%)"; the request path is counted in the existing "Spieda" and "Ievadīja e-pastu".
- **Code:** `src/ui/ShopLink.tsx` (the link and the sheet), `src/ui/useRequest.ts` (the request state shared with `SaveButton`), `src/app/go/[offerId]/route.ts`, `src/services/notify/events.ts`.
