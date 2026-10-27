# Trilio — Product specification (from design phase, 17 Oct 2026)

UI strings are in Latvian, as they appear in the prototype. The explanations are in English.

## 1. Entry points
- **Welcome screen.** Headline: "Pastāsti, kas tev vajadzīgs. Trīs labākos variantus atradīsim mēs." (Tell us what you need. We'll find the three best options.) Two buttons:
  - "Palīdzi izvēlēties" (help me choose) starts the guided flow.
  - "Es jau zinu modeli" (I already know the model) starts the model-check flow.
- **Header:** logo, "Cenu radars" link, and an "Ienākt" (sign in) button. When the user is signed in, the button becomes an avatar with the user's initial.
- **Footer:** "Salīdzinām cenas partneru veikalos" (we compare prices in partner shops) and a back button.

## 2. Guided flow (Typeform-style)

**Owner decision (18 Oct 2026): the Steve Jobs approach.** After the first real-data test with fridges, the owner asked that the flow:
- asks up front only what fit, price or the kind of product depends on, so the number of screens varies by category;
- shows kinds of product as picture cards;
- opens every screen on a sensible default taken from real stock;
- never leads to a dead end;
- uses min–max ranges for price and height instead of fixed steps.

**Owner decision (18 Oct 2026, later the same day): pictures used wisely.** No illustrative people in the drawings. Pictures appear only where the shape or the size is what the shopper decides by, and they show the appliance (and the furniture it fits into) drawn to one scale within a question. Sizes are cards with numbers people know (fridges: ~54 cm, ~85 cm, 125–160 cm, 166–180 cm, 181–205 cm; built-in niches 82–88 / 102–123 / 140–158 / 177–178 / 194 cm), asked after freestanding vs built-in, followed by the number of doors. A few extra steps are fine when each one is meaningful. Choices that are not visual (heat pump vs condenser, cups a day, household size) are plain text cards.

**Owner decision (23 Oct 2026): a pricier pick must earn its price.** A product that costs more than another pick and is not better overall is never offered (fewer than three picks is fine, and the page says why). The comparison box on a pricier card leads with what the extra money buys ("Plusi: …": wishes met, better specs, a higher Trilio rating, a more reliable brand) and lists downsides apart ("Mīnusi: …"; "Bet: …" is reserved for the one market catch per card, 27 Oct 2026). See `docs/UPGRADE_REASONS_PLAN.md`.

**Owner decision (21 Oct 2026): product photos on products, drawings in questions.** Result cards, the model check and saved products show the shop's photo of that exact product (on a white tile, through our own image optimiser, from the stores' configured image hosts only); without a usable photo the subcategory drawing is shown. Question cards keep the to-scale drawings. Energy-label products matched in EPREL show the EU class arrow with links to the official label and product information sheet (`docs/PICTURES_AND_LLM_PLAN.md`).

Everything else (priorities, brands, urgency, refurbished) is refined on the results page. The rules and their reasons are in `docs/FILTERS_PLAN.md` ("Core: the Jobs rules").

- One question per screen, large type, and a progress bar. The counter reads "Jautājums N no M" (question N of M). M counts the flow questions that matter right now, plus the price screen. It changes when a conditional question appears or one is skipped.
- **Defaults.** Each choice screen opens with the most common answer in current stock pre-selected, so "Tālāk" (next) is always one tap. Tapping an option also auto-advances after about 260 ms.
- **Picture cards.** Choices between kinds of product show a line drawing per option (`option.illustration`). Other choices are plain rows.
- **Live counts.** Each option shows how many in-stock products it would leave ("42 preces"). An option with 0 products is shown dimmed with "Pašlaik nav pieejams" (not available right now), not hidden.
- **Size limits** (fridge and freezer height, washer depth, dishwasher niche) open on "Nav ierobežojuma" (no limit). "Ir ierobežojums" (there is a limit) reveals a slider for the upper limit, with presets. Built-in niche height is a number input with a tolerance.
- **Skipped questions** (`src/domain/flow/insight.ts`). Before a screen is shown, the code checks it against the products that are left:
  - a question is skipped when every answer would leave the same products;
  - a hard-filter, range or number question is skipped when fewer than 50 % of the remaining products state the attribute it needs (`MIN_COVERAGE`), because asking would hide most of the stock;
  - a soft question with no attribute conditions (coffee cups per day, which only feeds advice) is always kept;
  - with nothing left in stock the question is still asked, and the dead-end prompt explains.
- Many questions have a "Kāpēc jautājam:" (why we ask) note, and some offer a "Nezinu" (I don't know) button that reveals help text instead of advancing.
- Every step has a back button. Answers are kept when going back. The answers live in the URL (`?a=`), so refresh and sharing work.

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
   - Personīgā kopšana (personal care: shavers, trimmers, hair dryers, stylers, electric toothbrushes, epilators; owner request, 19 Oct 2026)
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
- Questions are data in `data/categories.json` (schema: `docs/QUESTION_SCHEMA.md`). Each question has a `stage`: `flow` (asked before results) or `results` (a chip on the results page).
- Every flow question states why it is asked up front (`up_front_reason`, enforced by a test):
  - **fit**: a wrong answer means the product does not fit or does not work (size, niche, placement, connection);
  - **kind**: it changes which kind of product is right (type, household size, cups a day);
  - **price**: sets the price range. Only the shared price screen does this today.
- A hard-filter answer (`hard_filter: true`) excludes products that contradict it. A soft answer only adds score (§3.1).
- **The last screen is always price: "Cik vēlies tērēt?"** (how much do you want to spend?)
  - A two-handle slider over the real prices of the products the earlier answers leave, with a small histogram.
  - It opens on the 20th–80th percentile of those prices, rounded outward to €10.
  - The subcategory's `budget_steps_eur` are quick presets under the slider. "Budžets nav noteikts" (no set budget) is always available.
  - The button reads "Rādīt labākos 3 no N" (show the best 3 of N) when more than three match, else "Rādīt N preces" (owner, 20 Oct 2026: "Rādīt 202 preces" promised more than the page shows). If the range leaves nothing, the screen offers the one change that fixes it: "Šajā cenu robežā nav nevienas preces — paplašināt līdz X?" (nothing in this price range — widen to X?).
  - The answer is stored as a min–max range in cents, or "none". The SEO landing pages `/kategorija/[sub]/[budget]` still work: the budget in the URL becomes the maximum.
- Priorities ("Kas tev vēl ir svarīgi?", up to 2), brands, urgency and refurbished are **not** flow screens. They are results-page chips (§3).

The table below is generated from `data/categories.json` (18 Oct 2026). Each row lists the flow questions in order, as `id`, control and options, then the up-front reason. "soft" marks a question that scores instead of filtering. The last column lists the priority chips on the results page. Price is asked last in every subcategory and is not repeated in the table.

| Subcategory | Flow questions, before price | "Kas tev vēl ir svarīgi?" chips |
|---|---|---|
| fridge | `install` picture cards: Brīvi stāvošs / Iebūvējams — **fit**<br>`size` picture cards: ~54 cm / ~85 cm / 125–160 cm / 166–180 cm / 181–205 cm — **fit**; only if `install` is free<br>`niche` picture cards: 82–88 cm / 102–123 cm / 140–158 cm / 177–178 cm / 194 cm un vairāk — **fit**; only if `install` is builtin<br>`doors` picture cards: Vienas durvis / Divas durvis / Side-by-Side vai French Door — **kind**<br>`hinge` picture cards: Durvis uz durvīm / Slīdošās / Nezinu — **fit**; only if `install` is builtin<br>`household` single: 1–2 / 3–4 / 5 vai vairāk — **kind**, soft | Nav jāatkausē, Klusums, Zems patēriņš, Liels tilpums |
| freezer | `form` picture cards: Vertikālā / Lādes / Iebūvējama — **fit**<br>`size` picture cards: ~85 cm / 125–160 cm / 170–200 cm — **fit**; only if `form` is upright<br>`niche` picture cards: 82–88 cm / 102–123 cm / 140–158 cm / 177–178 cm — **fit**; only if `form` is builtin<br>`place` single: Mājā / Garāžā vai neapsildītā telpā — **fit**<br>`amount` single: Nedaudz / Vidēji / Daudz — **kind**, soft | Nav jāatkausē, Klusums, Zems patēriņš |
| washer | `loading` picture cards: Priekšējā ielāde / Augšējā ielāde / Ar žāvētāju — **fit**<br>`place` picture cards: Atsevišķi / Zem darba virsmas / Iebūvēta — **fit**; only if `loading` is front/combo<br>`depth` picture cards: ~40 cm / ~45–50 cm / ~55–60 cm — **fit**; only if `loading` is front/combo<br>`household` single: 1–2 / 3–4 / 5 vai vairāk — **kind**, soft | Klusums, Zems patēriņš, Tvaika funkcija |
| dryer | `type` single: Siltumsūkņa / Kondensācijas — **kind**<br>`place` picture cards: Blakus veļas mašīnai / Uz veļas mašīnas — **fit**<br>`household` single: 1–2 / 3–4 / 5 vai vairāk — **kind**, soft | Klusums, Zems patēriņš |
| iron | `type` picture cards: Tvaika gludeklis / Tvaika stacija — **kind** | Pretkaļķu sistēma, Viegls |
| steamer | `type` picture cards: Rokas / Ar statīvu — **kind** | — |
| dish | `install` picture cards: Iebūvējama / Brīvi stāvoša / Galda — **fit**<br>`width` picture cards: 45 cm / 60 cm — **fit**; only if `install` is builtin/free<br>`integration` picture cards: Nē, paslēpts / Jā, virs fasādes — **fit**; only if `install` is builtin<br>`niche` picture cards: ~82 cm / ~86–87 cm — **fit**; only if `install` is builtin<br>`household` single: 1–2 / 3–4 / 5 vai vairāk — **kind**, soft | Klusums, Trešais grozs, Automātiska durvju atvēršana, Zems patēriņš |
| hob | `type` picture cards: Indukcijas / Keramiskā / Gāzes / Plīts ar cepeškrāsni — **fit**<br>`width` picture cards: Šaura, ~30 cm / Standarta, ~60 cm / Plata, 70 cm un vairāk — **fit**; only if `type` is not cooker | Elastīgā zona, Ātrā uzsilšana |
| oven | `niche` picture cards: Standarta, ~60 cm augsta / Kompakta, ~45 cm augsta — **fit** | Pirolītiskā tīrīšana, Tvaika funkcija, Vadība ar telefonu, Liels tilpums |
| hood | `type` picture cards: Pie sienas / Virs salas / Iebūvēts skapī — **fit**<br>`width` picture cards: ~50 cm / ~60 cm / 80–90 cm — **fit** | Klusums, Jaudīga nosūkšana, Bez izvada ārā |
| micro | `install` picture cards: Brīvi stāvoša / Iebūvējama — **fit**<br>`niche` picture cards: ~38 cm / ~45 cm — **fit**; only if `install` is builtin<br>`function` single: Tikai sildīt / Sildīt un grilēt / Arī cept kā cepeškrāsnī — **kind**<br>`household` single: 1–2 / 3–4 / 5 vai vairāk — **kind**, soft | — |
| vacuum | `type` picture cards: Robots / Robots ar mazgāšanu / Bezvadu / Ar vadu — **fit**<br>`area` single: Līdz 50 m² / 50–100 m² / Vairāk nekā 100 m² — **kind**, soft; only if `type` is not corded<br>`pets` single: Jā / Nē — **kind**, soft | Alerģija, Klusums, Bez maisiņiem |
| steamclean | `type` picture cards: Rokas / Tvaika mops / Ar tvertni — **kind** | — |
| coffee | `type` picture cards: Automātiskais / Kapsulu / Manuālais espresso — **kind**<br>`milk` single: Jā / Tikai melnu — **kind**<br>`cups` single: 1–2 / 3–4 / 5 vai vairāk — **kind**, soft | — |
| grinder | `type` picture cards: Ar dzirnakmeņiem / Ar asmeņiem — **kind** | — |
| kettle | `type` single: Metāla / Stikla / Ar temperatūras izvēli — **kind**, soft | — |
| blender | `type` picture cards: Ar krūzi / Personīgais — **kind**<br>`use` single: Smūtijiem / Arī ledum / Arī zupām — **kind**, soft | — |
| handblender | `type` single: Ar vadu / Bezvadu — **kind** | — |
| foodproc | `type` picture cards: Planetāro mikseri / Virtuves kombainu — **kind** | — |
| mixer | `type` picture cards: Rokas / Ar bļodu — **kind** | — |
| chopper | — (price only) | — |
| mincer | — (price only) | — |
| scale | `type` single: Virtuves svari / Precīzie svari — **kind** | — |
| knife | `type` single: Ar vadu / Bezvadu — **kind** | — |
| grill | `type` picture cards: Kontakta / Plātnes — **kind** | — |
| toaster | `slots` picture cards: 2 šķēles / 4 šķēles — **kind** | — |
| sandwich | `type` single: Sendviči / Arī vafeles un grils — **kind** | — |
| airfryer | `type` picture cards: Karstā gaisa / Eļļas — **kind**<br>`portions` single: 1–2 / 3–4 / 5 vai vairāk — **kind**, soft; only if `type` is air | — |
| breadmaker | — (price only) | — |
| minioven | `type` picture cards: Nē / Jā — **kind**<br>`size` single: Picai / Veselai vistai — **kind**, soft | — |
| juicer | `type` picture cards: Lēnā spiede / Centrifūgas / Citrusu — **kind** | — |
| dehydrator | `size` picture cards: Nedaudz / Daudz — **kind**, soft | — |
| vacuumsealer | — (price only) | — |
| shaver | `type` picture cards: Ar rotējošām galviņām / Ar sietiņu / Skuj un apgriež / Sieviešu — **kind**<br>`wet` single: Jā / Nē, tikai sausi — **kind**, soft; only if `type` is rotary/foil/lady | Ilgi strādā, Tīrīšanas stacija |
| trimmer | `type` picture cards: Bārdai / Matu griešanai / Ķermenim / Visam — **kind** | Ilgi strādā, Mazgājams zem ūdens |
| hairdryer | `hair` single: Īsi vai vidēji / Gari vai biezi / Vajag ceļojumiem — **kind**, soft | Mazāk sprogainu matu, Viegls |
| styler | `type` picture cards: Iztaisnot / Saloki / Žāvēt un veidot — **kind** | Temperatūras regulēšana, Mazāk sprogainu matu |
| toothbrush | `type` picture cards: Soniskā / Ar apaļu galviņu / Bērnu — **kind** | Spiediena sensors, Ar lietotni |
| epilator | `type` picture cards: Epilators / Fotoepilators (IPL) — **kind** | Lietojams dušā, Bezvadu |

Notes:
- chopper, mincer, breadmaker and vacuumsealer have no category questions yet, so their flow is the price screen only. `docs/FILTERS_PLAN.md` §6.3b proposes questions for them.
- Built-in fridges and freezers ask for the niche height as a number: a product passes when it is up to 6 cm lower or 0,5 cm higher than the niche. Height sliders allow 0,5 cm over the limit, because shops round.
- The freezer garage card filters on `garage_ok`, which is set when the climate class includes SN or the text mentions a garage.
- The dryer "Uz veļas mašīnas" (on top of a washer) card filters on `stackable`.
- Personal care has no brand reliability grades: no independent survey in the brand table's sources covers these devices, so every brand scores the same there (`ungradedSubcategories` in `data/brands.json`). Picks rest on specs and price.

### 2.3 Urgency ("Cik ātri prece tev vajadzīga?", how soon do you need it?)
Urgency is no longer a flow screen. It is the "Piegāde" (delivery) chip on the results page, set by default to "Tuvāko divu nedēļu laikā" (within two weeks).
- "Pēc iespējas ātrāk" (as soon as possible): in-stock offers only. The sublabel shows a concrete date, "piegāde līdz trešdienai, 21. oktobrim" (delivery by Wednesday 21 October), which is 3 working days from today.
- "Tuvāko divu nedēļu laikā" (within two weeks): offers that are in stock or coming soon. The date is shown.
- "Nesteidzos" (no rush): the same stock rule as two weeks. The sublabel points to the price radar.
- **Never use "this week" wording.** It is wrong when someone fills the form in on a Sunday.

## 3. Results
The results page is the second half of the conversation: it opens on a sensible answer and makes it easy to improve. Top to bottom:

- **Title:** "Trīs labākie varianti tev" (your three best options).
- **Lead text:** says how many products match the price range and whether there are over-budget extras. When the picks are too close in price for tiers to mean anything, it says so instead: "Šie varianti ir līdzīgā cenā, ap 390 € — izvēlies pēc tā, kas tev svarīgāk." (these options cost about the same, around €390 — choose by what matters more to you).
- **Filter bar ("Tavas izvēles", your choices).** It replaces the old answer chips. One chip each for:
  - every flow answer;
  - the price range;
  - "Kas vēl svarīgi?" (priorities);
  - "Zīmoli" (brands), shown only when the results have more than one brand;
  - "Piegāde" (urgency, §2.3);
  - "Atjaunotās preces" (refurbished), shown only when the subcategory has refurbished stock. It is on by default.

  Tapping a chip opens a sheet: a modal dialog on mobile, centred on desktop, that keeps focus inside and closes with Esc. It holds the same control as the flow screen, with option counts, and a live "Rādīt N rezultātus" (show N results) button. Applying it changes the URL and the server re-ranks with the same rules. "Mainīt atbildes" (change answers) still reopens the full flow.
- **Brands.** The chip is a multi-select with product counts and "Jebkurš zīmols" (any brand) as the default. Chosen brands are a soft preference worth +12 points. "Rādīt tikai šos zīmolus" (show only these brands) turns them into a filter.
- **EAN note:** "Cenas salīdzinām pēc EAN svītrkoda…" (we compare prices by EAN barcode).
- **"Kā mēs izvēlamies un prioritizējam?"** (how we choose and rank) expandable panel. It contains:
  - the filters we apply, including that products missing fit data are left out of the main picks;
  - the ranking factors;
  - what "Trilio ieteikums" (Trilio's recommendation) means, and that it is not shown when no option is clearly better;
  - the commission disclosure: it does not affect ranking;
  - the energy price assumption;
  - the prices behind the "Vērts zināt" notes (electricity, water);
  - the rule that refurbished items are always shown separately;
  - that a less important value we do not know is shown as "nav zināms" (not known), never guessed;
  - how many products each filter removed this time.
- **"Vairāk variantu" (more options): relax suggestions** (`src/domain/ranking/relax.ts`). When there are fewer than 3 picks, up to three one-tap links each add a stated number of products:
  - "+ 4 varianti, ja budžets līdz 550 €" raises the price limit by the first of ×1,1, ×1,25 or ×1,5 that adds anything;
  - removing the lower price limit;
  - "+ 7 varianti, ja augstums līdz 190 cm" raises a size limit by 5 or 10 steps, or removes it;
  - "…, ja arī citi zīmoli" (… if other brands too) turns off "only these brands";
  - "…, ja rādīt arī preces ar nepilniem datiem" (… if products with incomplete data are shown too) comes last, because the user does not control data quality.

  Every number comes from `countMatches`, the same rules as the results, so a suggestion is always true when tapped.
- **The story of the three** (docs/CONFIDENCE_PLAN.md, owner 24 Oct 2026):
  - a coverage line under the title: "Izskatījām 39 preces 3 veikalos (atjaunots šodien 17:06). 31 der tavām atbildēm un budžetam. Šie ir labākie — un lūk, kāpēc.";
  - "Kas tev svarīgāk?": the `priorities` options as one row of pills plus "Vienalga", one tap re-ranks;
  - the panel opens with this search's numbers (searched, met the answers, in budget, then how roles are earned) and says stars are shop reviews, shown only with 10 or more.
- **The three picks** (§3.1, §3.2). Pills say the **role** a pick earned against every product in budget, not its price position: "Saprātīgā izvēle" (best value), "Ja {prioritāte} ir galvenais" (best available on the priority and clearly ahead of the other picks), "Kalpos ilgāk" (best-graded brand, then warranty and model year), "Lētākais, ko paši pirktu" (the cheapest pick, past the quality floor). A pick may have no role. Price tiers remain only as the sort order and the `tier` data attribute.
- **"Kāpēc ne šie?"**: up to four products a shopper may meet elsewhere (the cheapest in range, the best-graded brand, the one most shops sell, the best reviewed) with one factual reason each: fails an answer (with the shopper's own limit), data the shop does not state, over budget, discontinued, a pick is no dearer and no worse, or a pick is better for a stated extra.
- **"Vai šie varianti deva pārliecību izvēlēties?"**: one anonymous tap; "Nē" asks what was missing. Numbers in the admin statistics.
- **Hidden-unknown line.** Products that pass every filter and the price range, but whose shop does not state a fit-critical value (size, form, installation), are not picks. One quiet line says so: "Vēl 6 precēm veikals nenorāda visus vajadzīgos datus. Rādīt arī tās" (6 more products are missing data from the shop. Show them too). Showing them marks each card with what is not known.
- **"Vērts zināt" (worth knowing)** (`src/domain/advice/advice.ts`). At most two notes about the recommended pick, or the first pick. Each note looks one step beyond the user's choices and states the trade-off with real numbers, with a link to the product:
  - an energy upgrade with yearly saving and payback. With the "Zems patēriņš" (low energy use) priority it is always considered; without it, only when payback is within 3 years;
  - quieter (at least 3 dB less), bigger (at least 15 % more volume) or No Frost for a small extra cost, when that priority is chosen;
  - dryers: a heat-pump model's payback against a condenser pick;
  - coffee: capsule cost per cup against an automatic machine, when it pays back within 36 months;
  - a cheaper product with the same capacity, when the price gap outweighs ten years of extra running cost;
  - vacuums: the yearly cost of bags, and a bagless alternative.

  Alternatives may cost at most 10 % over the price limit, or 15 % over the pick's price when no limit is set. Payback is shown only when it is shorter than the product's typical life: 10 years for fridges, freezers, washers, dryers and dishwashers, and 5 for everything else. Savings are rounded down and extra costs up, never in our favour. Assumed costs (`DEFAULT_COSTS`):
  - electricity: `ENERGY_PRICE_CENTS_PER_KWH`, default 0,25 €/kWh;
  - water and sewage: 3,50 €/m³ (**an unconfirmed assumption**, to be checked against the Riga tariff);
  - coffee: 0,15 € per cup from beans and 0,45 € per capsule;
  - vacuum bags: 20 € a year.

  All of this is deterministic code, never AI.
- **"Vērts apsvērt — {zīmols}" (worth considering)** (`src/domain/ranking/consider.ts`). At most one card, for a brand the user did not choose. It appears only when the user has chosen brands and `data/brands.json` is marked `reviewed: true`. The table (38 brands, graded 1–5 per category from independent reliability surveys, each value with its sources) was switched on on 18 Oct 2026. The owner delegated the review decisions: no evidence is inherited between sister brands, and a brand whose grade rests on low-confidence evidence is never suggested. The product must:
  - have a brand grade at least equal to the best chosen brand's;
  - have known fit data;
  - score at least as well as the top pick for less money, or better for no more money.

  It is never labelled as a recommendation.
- **Extras** over budget (§3.1 step 5), then the **compare table** (§3.4), then the **refurbished block** (§3.3).

### 3.1 Picking the three
Pure code in `src/domain/ranking/` (`filters.ts`, `score.ts`, `rank.ts`).
1. **Filter.**
   - In stock, or in stock or coming soon, depending on urgency.
   - "Only these brands", when that is on.
   - Every hard answer, evaluated three ways per product: it holds, it is contradicted, or the product does not state the attribute.
     - Contradicted products are out.
     - Unknown on a fit-critical value keeps the product out of the picks, but it is counted for the hidden-unknown line. Fit-critical means the question's `up_front_reason` is `fit`, or the attribute is in the subcategory's `fit` list in `data/attributes.json`.
     - Unknown on anything else is shown on the card as "nav zināms: …" (not known: …), naming the attribute, not the question.
   - Price inside the min–max range.
2. **Score.**
   - Base: the product rating (0–100), or 70 when unknown.
   - +12 for each matched soft answer.
   - Priorities: +15 for the first and +12 for the second.
   - +12 for a preferred brand.
   - Matches on hard filters explain the fit on the card but earn no points, because filtering is not ranking.
   - −40 when over budget, which only matters for extras.
3. **Picks** (`pickThree`): the best score, then the best-scoring product in the lower third of the prices on offer, then the best in the upper third. Any gaps are filled by score. The cheapest product is never picked just for being cheap, so an €89 mini fridge cannot appear in a €350–500 search.
4. **Display.**
   - Picks are sorted by price.
   - "Budžeta variants" (budget), "Vidējā klase" (mid-range) and "Augstākā klase" (top end) appear only when neighbouring picks are at least 10 % and €5 apart. Otherwise there are no tier pills, and the lead says the options are similar.
   - The lime **"Trilio ieteikums"** badge goes on the top-scoring pick only when it leads the next score by at least 5 points and its fit-critical attributes are known. With no clear winner there is no badge.
5. **Extras:** if fewer than 3 are within the range, add at most 2 extras that cost up to 25 % over its upper limit. They get a dashed orange border and a "Virs budžeta par X €" (over budget by X €) pill.
6. **None within budget or close:** say so, offer the relax suggestions, and suggest the radar.

### 3.1a More options on request
Under the three picks, "Rādīt vairāk variantus (N)" (show more options) lists the other products in the price range, ten per tap ("Rādīt vēl 10 variantus no N"), in the same best-value order as the picks (quality for the price, never commission). Owner, 20 Oct 2026.

### 3.2 Result card

Since 24 Oct 2026 (docs/CONFIDENCE_PLAN.md) a pick opens with its role pills and a **verdict**: one or two sentences built from the shopper's answer ("3–4 cilvēkiem 300 L ir īstais izmērs"), a lead on the priority or a deciding attribute ("Klusākais šajā budžetā: 35 dB"), reliability with its grade, ten-year cost, or shop reviews; with thin data it says so. A **catch** line follows the upgrade box ("Bet: trokšņa līmenis 39 dB; labākais pieejamais (34 dB) maksā +170 €"). Under the price, a **price confidence** line when the history shows it (stable 30 days, the lowest we have seen, all shops within a few euros). Evidence lines join "why it fits": shop reviews with count, warranty (the statutory 2 years when nothing more is stated), model year or "vairs netiek ražots". **No "Vērtējums x/10" is shown** (decision B5); the score stays internal to ranking.

- Tier pill (when meaningful), optional "Trilio ieteikums", and the score ("Vērtējums 8,6/10", rating).
- Product name and **"Modelis {code} · EAN {ean}"** (model code and EAN). When the shop's name does not say what the product is, the type is added after the brand: "Indesit veļas žāvētājs C YSD 83D WW EE" (`src/domain/catalog/naming.ts`).
- Spec line: the shop's, or the first known compare attributes.
- Best price and shop, with stock and delivery date in working days.
- **30-day price line:** "Šobrīd zemākā cena pēdējās 30 dienās" (currently the lowest price in 30 days), or "Zemākā cena 30 dienās bija X € — cenu radars paziņos…" (the 30-day low was X €, and the price radar will notify you…).
- **Upgrade delta** (every card except the cheapest; `src/domain/delta/delta.ts`): "Par +180 € vairāk nekā budžeta variants tu iegūsti: +48 L tilpums · par 4 dB klusāks · labāka energoklase (D) · No Frost" (for €180 more than the budget option you get…).
  - It compares the subcategory's `compare` attributes and tells three cases apart:
    - the values differ: list them;
    - every value is known and equal;
    - a value is unknown on one side: no box at all, because the box must never guess.
  - Downsides are included too, for example "~60 € vairāk par elektrību 10 gados" (~€60 more on electricity over 10 years).
  - Known and equal, different brands: "atšķirība galvenokārt zīmolā un dizainā" (the difference is mainly brand and design).
  - Known and equal, same brand: "tehniski līdzvērtīgi — atšķiras tikai cena" (technically equivalent — only the price differs).
- **Energy cost** for fridges, freezers, washers, dryers and dishwashers: "Elektrība 10 gados ~480 € · kopā ar pirkumu ~1 079 €" (electricity over 10 years ~€480, total with purchase ~€1,079). The price is configurable (default 0,25 €/kWh). kWh/year comes from the shop's spec table or feed today. EPREL lookups are planned but not built yet (`docs/ATTRIBUTES.md`).
- Up to 3 "why it fits" reasons, generated from the matched answers.
- "Nav zināms: …" (not known: …) naming any attribute the shop does not state.
- Other shops' prices, and the saving versus the most expensive shop.
- "Pirkt — {Shop}" (buy) as an affiliate link, and "Sekot cenai" (track price).

### 3.3 Refurbished block
- Blue colour scheme and the label "ATJAUNOTA PRECE · RĀDĪTA ATSEVIŠĶI" (refurbished item, shown separately).
- Same filters and price range as the picks. Up to 3 items.
- Model and EAN with the note "tas pats modelis, kas jaunā stāvoklī" (same model as the new one), condition grade, warranty, price, and the saving versus new.

### 3.4 Compare side by side
- The "Salīdzināt parametrus blakus" (compare side by side) button opens a grid with a sticky first column. It covers the picks and any extras.
- **Rows:**
  - lowest price and shop, availability, model/EAN;
  - one row per attribute in the subcategory's `compare` list in `categories.json`. A row unknown for every product is left out;
  - electricity over 10 years and total over 10 years, for energy-labelled categories;
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

## 5. Wishlist ("Vēlmju saraksts") and price e-mails

Owner decision, 20 Oct 2026: the wishlist replaces the price radar. Saving is one tap and free. Old `/radars` links redirect to `/velmju-saraksts`; the radar tables stay in the database, unused.

Owner decision, 24 Oct 2026 (docs/TRUST_POLISH_PLAN.md §1): **price-drop e-mails are free and on by default**, because saving is the request. The paid plan is retired: `/velmju-saraksts/pazinojumi` redirects to the wishlist; subscriptions bought earlier can still be seen and cancelled. Trilio's own personal offers stay a separate, explicit opt-in.

Why (evaluated from the shopper's side): the radar asked three questions and showed a payment screen on the first tap. A heart is one tap that everyone knows, shoppers see the value (today's best offer and the price history) before paying, and a saved search fits how appliances are bought: "fridge, ~186 cm, one door" rather than one model.

### 5.1 Saving (the heart)
- **A product:** "Saglabāt" on every result card (picks, extras, "more options", "Vērts apsvērt", refurbished), on the model-check page and on the category landing pages. A second tap removes it ("Saglabāts").
- **A search:** "Saglabāt meklējumu" under the results heading and in the panel below the picks. It saves the subcategory with every answer and the price range, named after them, e.g. "Tējkannas · Metāla · Jebkura cena".
- **Signed out:** the tap goes through sign-in (Google or e-mail) and saves on the way back to the same page (`/velmju-saraksts/pievienot`).
- One save per product or search per user. The price at saving is the baseline for "cheaper than when saved".
- **Under the heart, after saving a product:** "Saglabāts. Nosūtīsim e-pastu, ja cena samazināsies. · Nesūtīt" ("Tomēr sūtīt" turns it back on).
- **The first save only:** "Vai drīkstam reizēm piedāvāt pašu izdevīgāku cenu?" with two equal buttons, "Jā, sūtiet" and "Nē, paldies". Showing it counts as asked (`users.offers_asked_at`); it never returns on a card, and the checkbox stays in the wishlist and account pages.

### 5.2 The wishlist page (`/velmju-saraksts`, header heart)
- **Saved searches:** the name, today's recommended pick for those answers (ranked exactly like the results page) with price and shop, how many products match, the change since saving, "Skatīt rezultātus" (reopens the saved results) and a heart to remove.
- **Saved products:** today's best new in-stock offer and shop, the change since saving, a link to the shop, a 90-day price history (lowest price per day, with the lowest and highest written out) and a heart to remove. "Pašlaik nav pieejams" when no shop has it.
- **"Cenu e-pasti" panel:** one checkbox (on by default), the address, and while on "Par kādiem kritumiem ziņot?" (any drop, at least 5 % (default), at least 10 %). The same checkbox is on `/konts`.
- Account line and sign-out, as before.

### 5.3 E-mails (free)
- After each ingestion, one digest per user with alerts on at most, listing the saved items whose price dropped by the threshold: a product's best offer, or a saved search's recommended pick. Each item at most once a day; the reported price becomes the new baseline.
- E-mail only: a web app cannot rely on push (owner, 19 Oct 2026).
- No marketing, no countdowns; the e-mail links to the wishlist and ends with "Nesūtīt vairs cenu e-pastus" (a no-login page with one button, `/velmju-saraksts/atteikties/{token}`) plus RFC 8058 one-click headers (`/api/wishlist/unsubscribe/{token}`).

## 6. Identity of products
- The card shows the manufacturer model code and EAN, so the same name never hides different products.
- A refurbished offer shares the EAN with its new counterpart. The **condition field** from the shop keeps them apart.

## 7. Legal and trust notes (verify with a lawyer)
- EU Omnibus: price reductions must reference the lowest price of the prior 30 days.
- Disclose the main ranking parameters and the paid relationships (UCPD as amended).
- No dark patterns: easy cancellation, no fake urgency or scarcity.
- GDPR: radar requirements and answers are personal preferences. Provide account deletion and data export.
- Trademark: "Trilio" is also used by a US data-backup company (trilio.io). That's a different field, but run a trademark search before registering.

## Admin section and personal offers (owner, 24 Oct 2026)

The owner has an admin section (`/admin`, only for `ADMIN_EMAILS`):
- statistics, including Trilio's own cookie-less visit counts;
- users and their saved items;
- demand (products by how many people saved them);
- personal offers and orders, and system health.

Shoppers who opt in (a checkbox under the heart, never pre-ticked) can get a personal offer from Trilio for a product they saved. Trilio is then the seller:
- one-screen checkout;
- free delivery in Latvia;
- Paysera payment;
- Trilio's invoice;
- order tracking;
- the 14-day withdrawal right for private buyers.

These offers never appear in public results and never affect the ranking (rule 4). Details: `docs/ADMIN_AND_OFFERS_PLAN.md`.
