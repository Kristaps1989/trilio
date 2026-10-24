# Trust polish plan: the e-mail question, repeated verdicts, "Kāpēc ne šie?"

Owner review of the first confidence release (24 Oct 2026, air fryers on trilio.lv, phone). Three complaints, each with its root cause in the code, the fix, the copy, the tests and the decision the owner has to make. Points 4–6 are things the same screenshots show that the owner did not name but that would undo the fix if left.

Status: **plan, awaiting the owner's decisions in §7.**

---

## 1. "Ja atradīšu lētāk, pastāstīt pa e-pastu?" — nobody will tick it

### What the screenshot shows
After the heart turns into "Saglabāts", a grey box appears with a tiny checkbox and the question. Nothing says what you get, what it costs, or how often. It reads like a cookie banner.

### What it actually is
It is not the price-drop alert. It is the **consent for Trilio's own personal offers** (`OffersConsent`, `users.offers_opt_in`; docs/ADMIN_AND_OFFERS_PLAN.md §2.3): the admin buys a product from a distributor and e-mails the people who saved it an offer to buy it from Trilio. The price-drop e-mails about *shop* prices are a different thing: the paid wishlist digest (PRODUCT_SPEC §5.3, owner decision 20 Oct 2026), which today is sold on the wishlist page only.

So the shopper is shown the wrong question at the wrong moment. The thing they expect when they tap a heart ("tell me when it's cheaper") is not offered at all on the card; the thing that is offered (Trilio's offers) needs explanation they never see.

### Why it cannot simply be "default on"
A personal offer from Trilio is a commercial communication. Under the Latvian Information Society Services Law (art. 9) and GDPR, it needs a prior, active opt-in: no pre-ticked box, no "it's in the terms". Putting it into the service rules would make every offer e-mail unlawful, and the one-click unsubscribe we already send (RFC 8058) does not cure that. **The owner's instinct is right about the price-drop alert, and wrong about Trilio's offers. The fix is to separate them.**

### Proposal (recommended: A)

**A. Saving means "watch the price". Trilio's offers are asked once, with buttons.**

1. **The price-drop alert becomes part of the wishlist, free, on by default.** Saving a product *is* the request: "Saglabāts. Pastāstīsim pa e-pastu, ja cena nokritīs." with a visible one-tap "Nesūtīt" link in the same line. Legal basis: the user asked for it by saving (performance of the service they requested), and the disclosure is at the moment of saving, not buried. Every alert e-mail carries the unsubscribe link and `List-Unsubscribe` headers, like the offer e-mails do today. The account page gets one switch "Cenu paziņojumi par saglabātajām precēm".
   - Threshold: the existing `evaluateItem` logic (≥ 5 % or the saved threshold), at most one e-mail per item per day, as the digest does now.
   - The service rules (`/noteikumi` §wishlist) gain one sentence: saving an item means we e-mail you when its price in partner shops drops; you can turn it off in the account or from any e-mail.
2. **Trilio's personal offers stay opt-in, but asked once, properly.** The first time a signed-in user saves anything, a small sheet, not a checkbox:
   > **Vai drīkstam reizēm piedāvāt pašu izdevīgāku cenu?**
   > Ja kādu no tavām saglabātajām precēm varēsim pārdot lētāk nekā veikali, uzrakstīsim. Tikai par tavām precēm, bez reklāmām.
   > [ Jā, sūtiet ] [ Nē, paldies ]
   A tap on "Jā" is a valid consent. "Nē" is remembered (`offers_asked_at`), and the question is never shown again on a card; it stays available in `/konts` and on the wishlist page as the checkbox it is now.
3. **What happens to the paid digest.** With A, the per-item alert is free, so the paid plan loses its reason to exist for products. Two ways to go, the owner decides (§7, D1):
   - **A1 (recommended):** retire the paid plan. Trilio's revenue model is affiliate clicks and its own offers, not 2 € subscriptions; a free alert grows the wishlist, which is where the offers are sold. The Paysera work (task #31) is then not needed for the wishlist at all.
   - **A2:** keep the paid plan for *saved searches* only (the digest of "a better pick appeared for your fridge search"), and make product alerts free.

**B. Keep both opt-in, but make the question understandable.** Replace the checkbox with the same two-button sheet, asked once, for a combined "price drops and Trilio's offers" consent. Cheaper to build, lawful, but the alert most people want stays behind a question most will dismiss. Not recommended.

### Code
- `src/ui/SaveButton.tsx`, `src/ui/OffersConsent.tsx`: the line under the heart becomes the "Saglabāts · pastāstīsim, ja cena nokritīs · Nesūtīt" status; the offers question moves to a one-time `OffersAsk` sheet driven by `users.offers_asked_at` (migration `0011`).
- `src/services/wishlist/job.ts`: the per-item alert runs for every saved product whose user has `price_alerts` on (new column, default true), independent of `subscriptions`. The saved-search digest keeps its gate per D1.
- `src/services/wishlist/emails` (new or extended): one alert e-mail per item per day, the unsubscribe token and headers reused from `src/services/offers/emails.ts`.
- `/noteikumi`, `/privatums`: one paragraph each (lv + en).
- Analytics: `price_alert_off`, `offers_ask_yes`, `offers_ask_no` (docs/ANALYTICS.md).

### Tests
- Unit: alert job sends to default-on users with no subscription; does not send after "Nesūtīt"; the ask sheet appears once per user.
- e2e: save on a card → status line visible, no checkbox; the sheet appears on the first save only; "Nē" persists after reload; account switch toggles alerts.

---

## 2. Cards 2 and 3 say the same thing — "DREAME šajā kategorijā: uzticamība 4/5"

### What the screenshot shows
Two of the three picks are Dreame. Both verdicts are the brand line, word for word. Both fact lists are identical ("Ietilpst 3–4 porcijas", "Garantija 2 gadi (likumā noteiktā)"). A shopper reads that as "the site has nothing to say about these", the opposite of what the verdict is for.

### Root cause
`verdictFor` builds each card alone. The brand grade is a brand fact, so two picks of one brand get the same sentence; nothing in the page checks that the three verdicts differ. `factLines` always prints the legal warranty, which is true of every product in the EU and so says nothing. The `answer_fit` line repeats the shopper's bucket ("3–4 porcijas") instead of the product's own number, so an 11 L two-drawer fryer gets the same line as a 7 L one.

### Fix: a verdict must say what *this* pick has that the other two do not

1. **Verdicts are written for the three together** (`verdictsFor(picks, ctx)` replaces three calls to `verdictFor`). Rule: a sentence used on one card is not used verbatim on another. The brand line is allowed once; when two picks share the brand and the grade, the second pick gets its next-strongest claim, and the shared brand fact moves to a single line above the cards: "Divi no trim ir Dreame: zīmola uzticamība 4/5 neatkarīgos pētījumos."
2. **A contrast claim, new `kind: "contrast"`:** what this pick has over the other two on a deciding attribute, with numbers: "11 L un divas atvilktnes — vienīgais no trim, kam pietiek 6 porcijām." / "7 L, 2 300 W — par 28 € lētāks nekā DZ30, pietiek 4 porcijām." The contrast is computed from `decides` (knowledge.json) first, then the compare attributes; a pick that leads on nothing gets its price position instead ("Lētākais no trim ar zīmola uzticamību 4/5").
3. **`answer_fit` uses the product's number, not the bucket:** "11 L — pietiek 6 porcijām" (the largest bucket the value satisfies), not the answer the shopper tapped.
4. **Facts that are the same on all three cards are shown once**, under the cards, not three times: "Visiem trim: garantija 2 gadi (likumā noteiktā)". A fact stays on the card only when it differs between picks (a 5-year manufacturer warranty, a model year, reviews).
5. **"Zīmolam nav neatkarīgu uzticamības datu" loses the green tick.** It is a caveat; it gets the neutral "–" marker the whyNot box uses, and sits last.
6. **"Cenu vēsture vēl krājas — vēlmju sarakstā to redzēsi"** also appears on every card. Show it once, on the first card only, or drop it until history exists (we have 14 days of snapshots by then anyway).

### Honesty check that goes into the all-categories e2e
- The three verdict strings are pairwise different.
- No fact line appears on all three cards.
- Every pick with a role has at least one sentence containing a number from its own attributes.

### Code
- `src/domain/confidence/confidence.ts`: `verdictsFor`, `contrastFor`, `sharedFacts`; `answer_fit` carries `bucketLabel` computed from the product's value.
- `src/app/[locale]/rezultati/page.tsx`, `ResultCard.tsx`: the shared line above the cards (`data-shared-facts`), the caveat marker.
- `confidence-text.ts`: `contrast` sentences; lv + en keys `verdictContrast*`, `sharedBrand`, `sharedFacts`.

---

## 3. "Kāpēc ne šie?" — badly formatted, reasons unclear

### What the screenshot shows
```
Clatronic fritieris FR 3649 viena plīts 2,5 l 1600 W melna · 50 €
«Frytkownica beztłuszczowa Tristar Tristar Digital Airfryer | FR-9073 |
Jauda 1800 W | Tilpums 9 L | Karstā gaisa tehnoloģija | Melns» par +4 €
ir labāks: +200 W jauda

AIR FRYER/AF30 DREAME AF30 (6978515256110) · 79 €
tāda pati cena kā «Dreame Air Fryer AF30-WH White», bet nevienā parametrā labāks
```
Four separate faults:

| Fault | Cause |
|---|---|
| Names are the shop's raw titles: Polish, pipes, spec tails, EAN in brackets, "Tristar Tristar", ALL CAPS | `displayName` only inserts the type word; nothing strips feed noise. The pick's name is then quoted *inside* the reason, so one line becomes five. |
| "+200 W jauda" as the whole reason | `delta.ts` treats `power_w` as higher-is-better (minDelta 200). For an air fryer wattage is a proxy for size, not a benefit. `leadsStrong` ("Jaudīgākais") has the same problem. |
| "AIR FRYER/AF30 DREAME AF30 … tāda pati cena kā Dreame AF30-WH, bet nevienā parametrā labāks" | It is the same model in black. Variants of a pick (same brand + model stem, differ by colour) should never be in the list. |
| Lower-case sentence starts, «» quotes, "nevienā parametrā labāks" (ungrammatical: "ne par ko labāks") | copy |

### Fix

1. **Clean names, everywhere (`src/domain/catalog/naming.ts`, `cleanName`)**, applied at display time and to the compare table and e-mails, never rewriting the DB:
   - cut everything from the first ` | `, ` – ` spec tail or `(EAN)`; cut trailing "melna/balta/black" only when a colour attribute exists;
   - collapse a doubled brand ("Tristar Tristar"); title-case ALL-CAPS words longer than 3 letters; keep model codes as the shop wrote them;
   - when `brand` and `modelCode` are known and the cleaned name is still longer than 48 characters, use `"{Brand} {typeLabel} {modelCode}"`: "Tristar karstā gaisa friteris FR-9073".
   - Unit tests on the three names in the screenshot and the existing fixtures.
2. **Short references:** inside a reason, the pick is named by brand + model code ("Dreame AF30-WH"), or by its role label when it has one ("Saprātīgā izvēle"), never by the full title, never in «».
3. **Layout:** one row per product: name (semibold) left, price right, one reason line under it starting with a capital, 15 px. Tap on the name opens the compare table with that product added (already supported by `?add=`), so "why not" is checkable.
4. **Reason copy (lv):**
   - dominated, same price: "Tāda pati cena kā Dreame AF30-WH, bet ne par ko labāks."
   - dominated, dearer: "Par 4 € dārgāks nekā Tristar FR-9073 un ne par ko labāks."
   - weaker: "Tristar FR-9073 par 4 € vairāk dod 9 L (šim 2,5 L)." — the gain is named with both values, only on a deciding attribute.
   - fit: "2,5 L — par maz 4 porcijām." / "Neatbilst tavai atbildei: ar eļļu."
   - unknown: "Veikals nenorāda tilpumu, tāpēc nevaram apstiprināt, ka der."
   - over budget: "Virs budžeta par 23 €."
   - discontinued: "Vairs netiek ražots."
5. **Which products are listed:**
   - exclude variants of a pick: same brand and the model code without a trailing colour/suffix token (`AF30` ≈ `AF30-WH`), or same name after cleaning;
   - exclude a product whose only "gain" over a pick is on an attribute with no direction in this category (see 4);
   - a candidate whose reason would be "weaker" with no deciding-attribute gain is skipped for the next candidate; the box shows 2–4 lines, or nothing, never a filler line.
6. **Title and lead:** "Kāpēc ne šie?" stays; lead becomes "Trīs, ko varētu redzēt citur, un viens iemesls katram."

### e2e (all categories)
- No why-not name contains `|`, `(`+13 digits+`)`, or a doubled word.
- Every reason starts with a capital letter and ends with a full stop.
- No why-not product shares brand + model stem with a pick.

---

## 4. Power is not a benefit for an air fryer (and leads on wrong attributes elsewhere)

The upgrade boxes in the screenshots say "Iegūsti: +1 200 W jauda" and "+500 W jauda". For a fryer, kettle or iron, more watts is faster heating at best; for a fryer it mostly means a bigger basket, which `volume_l` already says, and it costs more electricity. Today `delta.ts` has `power_w: higherIsBetter`, used for every category.

**Fix: direction per category, in data.** `data/attributes.json` gains `better: "max" | "min" | null` per subcategory key (default from the current `betterDirection`); `delta.ts`, `quality.ts` and the `leads` claim read it. Settings for the first pass:
- `power_w`: max for vacuums (suction proxy when `suction_pa` unknown), kettles (speed), microwaves, blenders, hobs (zones); **null** for air fryers, ovens, irons, coffee machines, toasters.
- `volume_l` for fryers: max, and it is the first `decides` entry.

Unit test: a 3 000 W fryer gains nothing on power over a 1 800 W one; a kettle does.

---

## 5. knowledge.json is empty for air fryers (and 27 other categories)

The release filled `decides`, `watchOut` and `answerPhrases` for 11 categories and left the rest generic. The screenshots are from one of the generic ones, which is why the verdicts fall back to the brand line and the facts are thin. Air fryer `decides`: volume (portions), drawers (`baskets`, new boolean/number attribute), dishwasher-safe basket, viewing window, preset programmes, noise; `watchOut`: "2,5 l pietiek vienam; ģimenei vajag 6 l+", "divas atvilktnes = divi ēdieni reizē", "jauda neko nepasaka par rezultātu".

**Fix:** write the 28 remaining categories now, prioritised by the admin's demand view, air fryers first, with the owner reading each (as with the brand table). Attributes that `decides` needs and the catalogue lacks (`baskets`, `dishwasher_safe`, `window`) are added to `attributes.json` with spec-table patterns and to the extraction key list.

---

## 6. "Saprātīgā izvēle" at 79 € has less volume than the 54 € pick

Pick 2 (Dreame AF30-WH, 7 L) costs 25 € more than pick 1 (Tristar, 9 L) and is smaller; its only gains are watts (see §4) and brand grade. With §4 applied, its upgrade box would read "zīmols ar pierādītu uzticamību (4/5)" and nothing else. Whether that earns 25 € and the "sensible" label is a ranking question, not a copy one.

**Fix:** the "earned price" rule (task #36) is tightened: a pricier pick must gain on at least one *deciding* attribute or feature, or on brand grade *and* reviews together; brand grade alone does not earn more than 15 % over the cheaper pick. If no pick earns its price, show two picks. The all-categories e2e already checks that pricier picks have a gains list; it gains the "deciding attribute or two-signal" rule.

---

## 7. Decisions for the owner

| # | Decision | Recommended |
|---|---|---|
| D1 | Price-drop alert: free and on by default when saving (A), and the paid plan: retired (A1) or kept for saved searches (A2) | **A + A1** |
| D2 | Trilio's own offers consent: a one-time two-button sheet after the first save, then only in the account and wishlist page | **Yes** |
| D3 | Facts identical across the three picks: one shared line under the cards (vs. hiding them) | **Shared line** |
| D4 | `power_w` neutral for fryers, ovens, irons, coffee, toasters; `data/attributes.json` carries direction per category | **Yes** |
| D5 | Fill knowledge.json for the remaining 28 categories now, owner reads each | **Yes, air fryers first** |
| D6 | Brand grade alone never earns more than 15 % over the cheaper pick (§6) | **Yes** |

## 8. Delivery

Four PRs, each green and merged before the next, e2e on mobile-360 and desktop as now:

1. **Names and why-not** (§3, §4): `cleanName`, per-category direction, the why-not rewrite, copy lv + en. Smallest blast radius, biggest visible change.
2. **Verdicts for the three together** (§2, §6): `verdictsFor`, contrast claims, shared facts, the earned-price rule.
3. **Wishlist alert and the offers ask** (§1): migration 0011, alert job and e-mail, the status line, the sheet, terms and privacy text, account switch. Waits on D1.
4. **Knowledge for 28 categories** (§5): data only plus the three new attributes; one PR per batch of ~10 so the owner can read them.

Metrics (admin "Pārliecība" section): share of saves that keep alerts on, offers ask yes-rate, why-not opens, and the confidence question's yes-share before and after PR 2.
