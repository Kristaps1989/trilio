# Trilio — Product specification (from design phase, 17 Oct 2026)

UI strings are in Latvian, as they appear in the prototype. The explanations are in English.

## 1. Entry points
- **Welcome screen.** Headline: "Pastāsti, kas tev vajadzīgs. Trīs labākos variantus atradīsim mēs." (Tell us what you need. We'll find the three best options.) Two buttons:
  - "Palīdzi izvēlēties" (help me choose) starts the guided flow.
  - "Es jau zinu modeli" (I already know the model) starts the model-check flow.
- **Header:** logo, "Cenu radars" link, and an "Ienākt" (sign in) button. When the user is signed in, the button becomes an avatar with the user's initial.
- **Footer:** "Salīdzinām cenas partneru veikalos" (we compare prices in partner shops) and a back button.

## 2. Guided flow (Typeform-style)
- One question per screen, large type, and a progress bar. The counter reads "Jautājums N no M" (question N of M), and M updates when conditional questions appear.
- Single-choice answers auto-advance after about 260 ms. Multi-choice (max 2) and number/text inputs have a "Turpināt" (continue) button.
- Many questions have a "Kāpēc jautājam:" (why we ask) note, and some offer an "I don't know" option that reveals help text instead of advancing.
- Every step has a back button. Answers are kept when going back.

### 2.1 Category selection
1. **Group tiles** with icons:
   - Ledusskapji un saldētavas (fridges and freezers)
   - Veļas mazgāšana un kopšana (laundry and garment care)
   - Virtuves lielā tehnika (large kitchen appliances)
   - Uzkopšana (cleaning)
   - Kafijas automāti un dzirnaviņas (coffee machines and grinders)
   - Virtuves mazā tehnika (small kitchen appliances)
   - Grili, tosteri un friteri (grills, toasters and fryers)
   - Veselīgam uzturam (healthy eating)
   - Full-width: "Kaut kas cits — pastāstīšu saviem vārdiem" (something else — I'll describe it in my own words)
2. **Subcategory list.** The full tree is in `data/categories.json`.
   - Duplicates from the shop menus are merged. Microwaves appear only once, with a question about countertop or built-in. Hoods and fridges likewise.
   - Vacuum types (robot, stick, cyclonic/bagged) are options inside the vacuum flow, not separate subcategories.
   - Consumables and accessories (coffee beans, accessories) are intentionally excluded.
3. **Free text ("Kaut kas cits").** The text is detected and routed straight to a subcategory's questions.
   - If it's outside household appliances, show "Pagaidām palīdzam izvēlēties tikai sadzīves tehniku" (for now we only help choose household appliances) with an email waitlist.
   - Store these requests: they are demand data for choosing the next category.
   - Production should use an LLM classifier and pre-fill any answers already given in the text, for example "quiet" or "has a dog".

### 2.2 Questions per subcategory
- **Generic subcategories:** 1–3 specific questions, then budget (4 subcategory-specific steps plus "Budžets nav noteikts", no set budget), then refurbished (only if refurbished stock exists for that subcategory), then urgency.
- `hard_filter: true` answers exclude non-matching products. Other answers add score.

**Fridges (bespoke flow):**
1. Type: built-in or freestanding. "Nezinu, kā atšķirt" (don't know the difference) shows help.
2. If built-in: niche height in cm (number input, default 178). The why-note says the wrong niche height is the most common reason for returns.
3. If freestanding: size class. Width is **not** asked, because nearly all fridges are 60 cm wide.
   - compact: ~85 cm, under the counter
   - mid: ~145–175 cm
   - tall: ~180–205 cm, followed by a question "Vai augstums ir ierobežots?" (is the height limited?) with answers ≤186 cm or no limit
   - wide: 80–90 cm Side-by-Side or French Door, with a note to check it fits through doors. The freezer question is skipped.
4. Freezer: yes or no.
5. Household size: 1–2, 3–4 or 5+. This sets the recommended volume (200, 300 or 380 L).
6. Priorities (pick up to 2): quiet, energy, No Frost, volume, price.
7. Budget (500, 800 or 1200 €, or not set).
8. Refurbished.
9. Urgency.

**Vacuums (bespoke flow):**
1. Type: robot, stick or corded (bagged or cyclonic).
2. Area to clean (≤50, 50–100 or >100 m²). This checks run time against need.
3. Floors: hard, many carpets, or mixed.
4. Pets.
5. Priorities (pick up to 2).
6. Budget.
7. Refurbished.
8. Urgency.

### 2.3 Urgency ("Cik ātri prece tev vajadzīga?", how soon do you need it?)
- "Pēc iespējas ātrāk" (as soon as possible): in-stock offers only. The sublabel shows a concrete date, "piegāde līdz trešdienai, 21. oktobrim" (delivery by Wednesday 21 October), which is 3 working days from today.
- "Tuvāko divu nedēļu laikā" (within two weeks): 3–5 working-day delivery is also fine, with the date shown.
- "Nesteidzos" (no rush): the results push the price radar.
- **Never use "this week" wording.** It is wrong when someone fills the form in on a Sunday.

## 3. Results
- **Title:** "Trīs labākie varianti tev" (your three best options).
- **Lead text:** says how many products match within budget and whether there are over-budget extras.
- **Answer chips.**
- **EAN note:** "Cenas salīdzinām pēc EAN svītrkoda…" (we compare prices by EAN barcode).
- **"Kā mēs izvēlamies un ranžējam?"** (how we choose and rank) expandable panel. It contains:
  - the filters we apply;
  - the ranking factors;
  - what "Trilio ieteikums" (Trilio's recommendation) means;
  - the commission disclosure: it does not affect ranking;
  - the energy price assumption;
  - the rule that refurbished items are always shown separately.

### 3.1 Picking the three
1. **Filter:** in stock (or in stock / coming soon, depending on urgency), matches all hard filters, and price ≤ budget.
2. **Score:** base rating × 10, plus answer bonuses (each matched soft answer +12 in generic flows; bespoke flows weight priorities). There is a −40 penalty for over budget, but that only matters for extras.
3. **Picks:** best score, the cheapest of the rest, and a third (the best remaining by score or by the first priority).
4. **Display:** sort by price and label "Budžeta variants" (budget), "Vidējā klase" (mid-range) and "Augstākā klase" (top end). The **"Trilio ieteikums"** lime badge goes on the highest-scoring pick (it can be any tier).
5. **Extras:** if fewer than 3 are within budget, add at most 2 extras up to +25 % over budget. They get a dashed orange border and a "Virs budžeta par X €" (over budget by X €) pill.
6. **None within budget or close:** say so and suggest raising the budget or turning on the radar.

### 3.2 Result card
- Tier pill, optional "Trilio ieteikums", and the score ("Vērtējums 8,6/10", rating).
- Product name and **"Modelis {code} · EAN {ean}"** (model code and EAN).
- Spec line.
- Best price and shop, with stock and delivery date in working days.
- **30-day price line:** "Šobrīd zemākā cena pēdējās 30 dienās" (currently the lowest price in 30 days), or "Zemākā cena 30 dienās bija X € — cenu radars paziņos…" (the 30-day low was X €, and the price radar will notify you…).
- **Upgrade delta** (every card except the cheapest): "Par +180 € vairāk nekā budžeta variants tu iegūsti: +48 L tilpums · par 4 dB klusāks · labāka energoklase (D) · No Frost" (for €180 more than the budget option you get…).
  - Downsides are included too, for example "~60 € vairāk par elektrību 10 gados" (~€60 more on electricity over 10 years).
  - If nothing differs: "atšķirība galvenokārt zīmolā un dizainā" (the difference is mainly brand and design).
- **Energy cost** for fridges, freezers, washers, dryers and dishwashers: "Elektrība 10 gados ~480 € · kopā ar pirkumu ~1 079 €" (electricity over 10 years ~€480, total with purchase ~€1,079). The price is configurable (default 0,25 €/kWh). kWh/year comes from EPREL.
- Up to 3 "why it fits" reasons, generated from the matched answers.
- Other shops' prices, and the saving versus the most expensive shop.
- "Pirkt — {Shop}" (buy) as an affiliate link, and "Sekot cenai" (track price).

### 3.3 Refurbished block
- Blue colour scheme and the label "ATJAUNOTA PRECE · RĀDĪTA ATSEVIŠĶI" (refurbished item, shown separately).
- Model and EAN with the note "tas pats modelis, kas jaunā stāvoklī" (same model as the new one), condition grade, warranty, price, and the saving versus new.

### 3.4 Compare side by side
- The "Salīdzināt parametrus blakus" (compare side by side) button opens a grid with a sticky first column.
- **Rows:**
  - lowest price and shop, availability, model/EAN;
  - category parameters (fridge: dimensions, volume, energy class, noise, No Frost, freezer; vacuum: type, run time, noise, mopping, pet brush; generic: one row per question plus specs);
  - electricity over 10 years and total over 10 years;
  - Trilio rating.
- **Highlighting:** the best value per row is shaded green, but not when all values are equal.
- **"Rādīt tikai atšķirības"** (show differences only) hides identical rows. Price, model and rating always stay.

### 3.5 Bottom of results
- Price-radar call to action: "Ieslēgt cenu radaru · 1 €/mēn." (turn on the price radar).
- "Mainīt atbildes" (change answers) and "Sākt no jauna" (start over).

## 4. Model-check flow ("Es jau zinu modeli")
1. The user enters a model name, model code or shop link.
2. Fit question, with dimensions and help text.
3. Results: "Tava izvēle" (your choice), the "Izdevīgāks par to pašu naudu" (better value for the same money) recommendation, and an alternative.
   - Alternatives must be the same size class and within ±12 % of the price.
   - Rank them by **total cost of ownership** (price + 10-year electricity).
4. The lead text explains the trade-off. A refurbished copy of the same model appears in its own block.

## 5. Price radar ("Cenu radars", €1/month)

### 5.1 Setup (from any card's "Sekot cenai")
1. **"Kad tev paziņot?"** (when should we notify you?):
   - any drop
   - at least −5 %
   - at least −10 %

   **No target price**: the owner decided a target price may never be reached.
2. **"Vai ziņot arī par citiem modeļiem ar labu cenu?"** (notify about other good-value models too?):
   - only this model (the code is shown)
   - other models from the same brand
   - any brand

   Alternatives must satisfy the user's saved requirements.
3. **"Kā tev paziņot?"** (how should we notify you?): push, email, or both.
4. **Sign in**, if the user isn't signed in yet: Google or an email magic link (Apple deferred by the owner on 18 Oct 2026). The text explains why an account is needed: to manage filters from any device.
5. **Plan screen:** €1/month, unlimited tracked products, prices checked several times a day, cancel anytime.
6. **Payment:** Apple Pay and Google Pay buttons, then a card form.
   - Card number grouped in fours, MM/GG expiry auto-formatted, CVC, name.
   - Validation messages are in Latvian.
   - Note: "Kartes datus apstrādā [PSP] — Trilio tos neredz un neglabā" (card data is handled by the payment provider; Trilio never sees or stores it).
7. **Confirmation**, with links to the radar page and back to results.

Users who are already subscribed skip the plan and payment steps. Users who are signed in skip the sign-in step.

### 5.2 Radar page
- **Per tracked item:** a pause/resume switch, the price, its change, a 30-day sparkline, and model/EAN.
- **"Filtri — Mainīt"** (filters — change) panel:
  - threshold;
  - shops to watch (at least one);
  - scope (only this model / same brand / any brand);
  - include refurbished (new items only).
- The panel's summary line looks like "kritums vismaz 5 % · visi veikali · + citi Bosch modeļi" (drop of at least 5 % · all shops · + other Bosch models).
- A comparable-model suggestion box appears according to the scope setting.
- "Pārtraukt sekot" (stop tracking) with an undo toast.
- Notification channels.
- **Subscription and payment:**
  - Current method ("Karte •••• 4242, derīga līdz 08/28", card ending 4242, valid until 08/28, or Apple Pay / Google Pay), with "Mainīt" (change) to update it inline.
  - "Atteikties no abonementa" (cancel subscription) asks for confirmation, then shows "Atjaunot abonementu" (resume subscription).
- Account line ("Ienācis kā… · Google", signed in as… via Google) and "Iziet" (sign out).
- When signed out, the page shows only the sign-in options (Google and email; Apple deferred).

## 6. Identity of products
- The card shows the manufacturer model code and EAN, so the same name never hides different products.
- A refurbished offer shares the EAN with its new counterpart. The **condition field** from the shop keeps them apart.

## 7. Legal and trust notes (verify with a lawyer)
- EU Omnibus: price reductions must reference the lowest price of the prior 30 days.
- Disclose the main ranking parameters and the paid relationships (UCPD as amended).
- No dark patterns: easy cancellation, no fake urgency or scarcity.
- GDPR: radar requirements and answers are personal preferences. Provide account deletion and data export.
- Trademark: "Trilio" is also used by a US data-backup company (trilio.io). That's a different field, but run a trademark search before registering.
