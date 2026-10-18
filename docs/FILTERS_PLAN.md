# Filters and results plan (October 2026)

Owner feedback on 18 Oct 2026, after the first real-data test with fridges:

1. A height limit of up to 178 cm returned only small (~80 cm) fridges.
2. Fridge type should be picked from visual cards: small, standard, double door.
3. The user should be able to pick preferred brands, and the system should point out an equally good brand they did not pick.
4. A €500 budget returned an €89 mini fridge. Price and height should be min–max ranges.
5. The first results should be easy to adjust (price, size, brands) so the user finds the right product on the first try.

The guiding principle is to show the thing instead of describing it. Use few choices, choose sensible defaults, give instant feedback, and never leave the user at a dead end.

**Owner answers (18 Oct, evening):**
- Keep it cost effective; use AI wherever it adds value.
- Every product must end up with complete, normalised data, found from public sources when the shop does not give it.
- Results must advise the user. Example: with a range of €310–523 and "low energy" as a priority, say that €20 more buys class A instead of B, and that the difference pays back in about a year.
- The EPREL API key has been requested.

**Deploy rule while this is built:** nothing is pushed until the owner says the first ingestion run has finished. The work happens on the local branch. Phase 0 also makes later deploys safe during ingestion.

---

## Why the results were wrong (root cause)

The filters work. The data they filter was empty.

- **The scraper keeps only the page's JSON-LD block**: name, brand, EAN, price and stock. Every product therefore has `attributes = {}` and `tags = []`: no height, volume, type, freezer flag or energy class. The shop pages do carry spec tables. tet.lv has "Izmēri (G x P x A): 300 x 250 x 2…", "Jauda (W)" and "Svars", and euronics.lv has its own "Jauda | 2500 W | …" table. We never read them.
- **Attribute extraction with Claude** (`FEATURE_LLM_EXTRACT`) is off in production, so nothing fills the gap.
- **A missing value passes a hard filter as "unconfirmed"** (`passesHardFilters` in `src/domain/ranking/filters.ts`). That rule was meant for feeds that leave out one field, not for products with no data at all. Every fridge passed the height filter, including 80 cm ones.
- **The budget is a maximum only**, and the three picks are best score, then **the cheapest of the rest**, then the next best. With no attributes, every score is about equal, so "cheapest" won: the €89 mini fridge.
- **Shop mis-categorisation leaks in.** m79.lv lists toys under "Kafijas automāti". Nothing checks that a product really is a fridge.

Any UI work on top of empty data would look broken in the same way. **Data comes first (phases 0–1). Logic (2) and the experience (3–4) follow.**

---

## Phase 0 — Make ingestion deploy-safe (small, do first)

Ingestion now runs inside the web service. Each shop's offers are saved only when that shop finishes, so a deploy loses up to 100 minutes of work.

- **Save in batches.** The crawler hands parsed products to the upsert every 100 pages, not once at the end. A redeploy then loses at most about 2–3 minutes of pages.
- **Stop cleanly on deploy.** On `SIGTERM` (Railway sends it on redeploy), stop the crawl, save what was read, and close the run with `stopReason = "shutdown"`. The next check resumes with the pages not yet seen; rotation already exists.
- **Schedule each shop on its own.** Today one guard covers the whole job, so a crash after tet finished keeps euronics and m79 waiting for four hours. Instead, each shop becomes due when its own last finished run is four hours old and it has no live run.
- **Time limit for sitemap reading too.** Today the time budget is checked only between product pages. Reading the sitemap index has no limit, so a slow shop can overrun its budget.
- **Log progress every 100 pages:** `ingest m79: 400/2000 pages, 371 offers`. Railway logs then show a live run, and `/api/status` gains `pagesSoFar`.
- Result: deploys no longer need to wait for ingestion.

## Phase 1 — Complete, normalised product data (target: every product shown has every key attribute)

Each source fills only what earlier ones left empty, cheapest first. Every value records its source (`spec_table`, `eprel`, `same_ean`, `claude_web`) so the card can say where a number came from.

**1.1 Spec-table parsing (deterministic, all three shops)**
- A parser per shop for its spec table (`scrape/specs/<shop>.ts`). It returns label → value pairs, keeping the shop's own Latvian labels.
- A mapping table per subcategory turns labels into our attributes. For fridges:
  - `height_cm`, `width_cm`, `depth_cm`;
  - `volume_l`, plus `fridge_volume_l` and `freezer_volume_l`;
  - `energy_class`, `noise_db` and `no_frost`;
  - `freezer_position` (top, bottom, none, side);
  - `install` (built-in or freestanding);
  - `doors`.
- Unit and number cleaning: "185,5 cm", "1855 mm" and "300 x 250 x 2…" in shop order (G x P x A means depth × width × height).
- Tags are derived from attributes by code, not guessed. For example `form = combi_bottom` when the freezer is at the bottom and the height is 150 cm or more.
- Unit tests use saved real pages as fixtures (two per shop per subcategory).

**1.2 EPREL enrichment (EU energy-label database)**
- For appliances with an energy label (fridges, freezers, washers, dryers, dishwashers, ovens, hoods), look up EPREL by EAN or model.
- EPREL gives official dimensions, volumes, energy class, kWh/year and noise.
- EPREL values win over shop values for these fields. The spec's energy-cost line already assumes kWh/year comes from EPREL.
- Owner action: register a free EPREL public API key and add it as `EPREL_API_KEY`.

**1.2b Same product, other shop (free)**
- Products are already merged by EAN, so a value that tet.lv lists fills the same field for euronics.lv and m79.lv.
- This costs nothing and should close most gaps once all three shops are read.

**1.3 Claude extraction for the remaining gaps**
- Turn on `FEATURE_LLM_EXTRACT=1` once 1.1 and 1.2 have run. Extraction then fills only what is still missing, as `docs/LLM.md` already says.
- It now receives the spec table text as well as the name.
- **Claude with web search, last resort.** Only for products that still miss a fit-critical value (height, width, form, volume) after every source above. It searches the manufacturer's page by EAN and model code and must return the source URL; values without a source are discarded.
- **Cost control.**
  - Extraction runs once per product, never per visitor.
  - It uses the cheapest Claude model that passes a quality check: 50 products with known values, measured before switching it on.
  - Web search runs only for the remaining gaps.
  - The existing daily cap and usage log stay.
- Products that still miss a fit-critical value after all of this are never shown as a pick (2.2). They are listed in the coverage report so they can be fixed by hand.

**1.4 Category sanity check**
- A product joins a subcategory only if its data fits: a fridge needs a fridge-like height or volume, or the word "ledusskap" in its name or breadcrumb.
- Otherwise it is rejected with the reason `category_mismatch`. This removes the m79 toys.

**1.5 Coverage report**
- `/api/status` gains, per subcategory, the share of products that have each key attribute (height, volume, type, energy class).
- Target before the new filters ship: at least 85 % of fridges have height and type.

## Phase 2 — Filter and ranking logic (`src/domain/ranking`, pure and tested)

**2.1 Range filters**
- Price and height become min–max ranges. The schema gains `type: "range"` questions with `{min, max, step, unit, defaultMin, defaultMax}` (`docs/QUESTION_SCHEMA.md`).
- A product passes when its value is inside the range. Height keeps the existing tolerance: up to 0,5 cm over the maximum, because shops round.

**2.2 Missing data is not a match**
- For **fit-critical** filters (height, width, built-in vs freestanding, product form), a product without the value does not appear in the main picks.
- Instead the results show one quiet line: "Vēl 6 ledusskapjiem veikals nenorāda augstumu — rādīt" (6 more fridges have no height listed by the shop — show). Opening them marks each one "Augstums nav norādīts".
- Comfort filters (No Frost, noise) keep today's "nav apstiprināts" (not confirmed) behaviour.

**2.3 Budget range and smarter picks**
- The budget is "no less than X, no more than Y".
- The picks still span the range: best score, best value in the lower third, best in the upper third.
- Within the range, "cheapest" is no longer a goal in itself. A €89 fridge cannot appear in a €350–500 search.
- Rule 2 (extras up to 25 % over the maximum, labelled "Virs budžeta par X €") stays.

**2.4 Brands**
- An optional "Vēlamie zīmoli" (preferred brands) step and filter: multi-select with product counts. "Jebkurš" (any) is the default.
- Preferred brands are a **soft** preference that adds score, not a hard filter. "Tikai šie zīmoli" (only these brands) is a separate toggle for people who are sure.

**2.5 "Līdzvērtīgs zīmols" (an equally good brand you did not pick)**
- Decided 18 Oct: AI where it adds value, ranking stays code. So AI provides the brand data, code makes the choice.
- `CLAUDE.md` rule 4 and `docs/LLM.md` say rankings and picks are deterministic code and never model output. That rule is what makes the "Kā mēs izvēlamies un ranžējam?" panel honest.
- The proposal keeps the AI as the brains behind the data, not the ranking:
  - `data/brands.json` is a brand quality table per category with:
    - reliability grade;
    - LV service network (yes or no);
    - typical warranty;
    - for fridges, compressor warranty;
    - the source for each value.
  - Claude drafts it from public sources and the owner reviews it before it ships. This is the same process as question sets for new categories.
  - Code then picks at most one extra card when a product of an unselected brand:
    1. has a brand grade at least equal to the best selected brand's, and
    2. beats or matches the top pick on score at a lower price, or on score + price.
  - The card is labelled "Vērts apsvērt — {zīmols}" (worth considering) with factual reasons, for example: "tāds pats tilpums un energoklase, par 70 € lētāk, 10 gadu kompressora garantija" (same volume and energy class, €70 cheaper, 10-year compressor warranty).
  - It never replaces the user's picks and is never labelled as a recommendation.

**2.6 Live counts**
- One pure function `countMatches(products, answers)` drives every "N atbilst" (N match) number in the flow and on the results page, so the numbers always agree.

**2.7 Advice that earns trust ("Vērts zināt", worth knowing)**
- A pure function looks one step beyond the user's choices and states the trade-off with numbers. It shows at most two notes per result, and only when the gain is real.
- **Energy payback.** When the price is near the top of the range and "Zems elektrības patēriņš" is a priority:
  - It finds a product up to 10 % over the maximum that is better on energy.
  - It calculates the yearly saving from EPREL kWh/year × the configured electricity price (default 0,25 €/kWh).
  - It shows: "Par +20 € — energoklase A, nevis B: ~18 € mazāk par elektrību gadā, atmaksājas ~1,1 gadā." (For +€20 — energy class A, not B: ~€18 less on electricity per year, pays back in ~1,1 years.)
- **Other priorities use the same pattern without a payback figure.**
  - Quiet: "Par +35 € — 35 dB, nevis 41 dB (uz pusi klusāks)" (for +€35 — 35 dB, not 41 dB, half as loud).
  - Volume: "+60 L par +25 €" (+60 L for +€25).
  - No Frost: "No Frost par +30 €" (No Frost for +€30).
- **Cheaper notes too.** For example: "Par 40 € lētāk — tas pats tilpums, energoklase C (+9 € gadā)" (€40 cheaper — same volume, energy class C, +€9 per year).
- **Honest by rule.**
  - The suggested product is shown as an extra with the existing "Virs budžeta par X €" (over budget by X €) label, within the +25 % rule.
  - Payback is shown only when it is under the product's typical life (10 years).
  - Figures are rounded down in the shop's favour, never in ours.
  - All of it is deterministic code, not AI.

**2.8 Card text that is always true (owner screenshot, 18 Oct 18:45, dryers)**

What the screenshot showed:
- Two Indesit dryers at 387 € and 396 €. The second card said "Par +9 € vairāk … tu iegūsti: atšķirība galvenokārt zīmolā un dizainā" (for +€9 you get: the difference is mainly brand and design), although both are Indesit.
- Both cards said "Nav apstiprināts: Kādu žāvētāju meklē?" (not confirmed: which dryer are you looking for?), which shows a raw question title.
- The cheapest one carried "Trilio ieteikums" (Trilio's recommendation) with nothing behind it.

What changes:
- **Unknown is not the same as equal.** `upgradeDelta` reports three cases separately:
  - the values differ (list them);
  - the values are known and equal;
  - a value is unknown on either side.

  The brand-and-design sentence is used only when the brands differ and every key attribute is known and equal. If the brands are the same and everything is equal: "Tehniski līdzvērtīgi — atšķiras tikai cena" (technically equivalent — only the price differs). This tells the user to take the cheaper one. If values are unknown, the box is not shown. A box must never guess.
- **Compare what matters for the category and the user's answers.** The delta lists the attributes behind the user's choices first, then the category's compare rows (`compare_row_labels` in `categories.json`). For dryers that means:
  - type: heat pump or condenser;
  - capacity: 8 vs 9 kg;
  - energy class and 10-year electricity cost;
  - noise.

  In the screenshot's case it would read, for example: "Par +9 € — 9 kg, nevis 8 kg; siltumsūknis (−35 € elektrībai 10 gados)" (for +€9 — 9 kg, not 8 kg; heat pump, −€35 on electricity over 10 years).
- **"Nav apstiprināts" names the attribute, not the question.** For example: "Nav zināms: žāvētāja veids". With complete data (Phase 1) this line almost never appears. When it does, the product is not a pick for a fit-critical question (2.2).
- **The recommendation must be earned.**
  - "Trilio ieteikums" is shown only when the top pick's score is clearly above the others and its key attributes are known.
  - With equal scores there is no badge. The panel "Kā mēs izvēlamies un ranžējam?" says why: "Šoreiz neviens nav skaidri labāks — izvēlies pēc cenas" (none is clearly better this time — choose by price).
- **Tiers must mean something.**
  - "Budžeta variants / Vidējā klase / Augstākā klase" are used only when the picks are meaningfully apart: at least 10 % or 30 € between neighbours.
  - Otherwise the cards are shown without tier pills and the lead says "Trīs līdzīgi varianti ap 390 €" (three similar options around €390). Two near-identical models from one brand are not shown as different classes.
- **The name says what the product is.** Card titles add the product type when the shop's name lacks it: "Indesit veļas žāvētājs C YSD 83D WW EE". The model line keeps the model code and EAN.
- **Tests.** One unit test per rule above, including:
  - same brand with unknown values → no box;
  - same brand with equal values → "Tehniski līdzvērtīgi";
  - different brands with equal values → the brand-and-design sentence;
  - picks within 10 % → no tier pills.

## Phase 3 — The fridge flow (one question per screen, visual)

**3.1 "Kāds ledusskapis tev vajadzīgs?" (which fridge do you need?)**
- Picture cards replace the type, size and freezer questions.
- Each card is a simple lime line drawing to scale, with a person silhouette for size. The label is underneath, plus a typical height and volume:

  | Card | Line | Drawing |
  |---|---|---|
  | **Mazs** (small) | zem virsmas, ~85 cm | an under-counter cube |
  | **Standarta** (standard) | ar saldētavu apakšā, 175–200 cm | the most common type, pre-selected |
  | **Bez saldētavas** (no freezer) | viss tilpums dzesēšanai | one tall door |
  | **Divdurvju** (double door) | Side-by-Side vai French Door, ~90 cm plats | two doors next to each other |
  | **Iebūvējams** (built-in) | aiz skapja durvīm | a cabinet front with a dashed outline inside |

- Each card shows a live count, "42 veikalos" (in 42 shops), from real stock. A form with 0 products is shown dimmed with "Pašlaik nav pieejams" (not available right now) instead of being hidden, so the layout stays stable.
- "Nezinu, kā atšķirt" (I don't know the difference) opens the existing help.

**3.2 "Cik augstu var būt?" (how tall can it be?)**
- A two-handle height slider. The default comes from the chosen card, e.g. standard → 170–205 cm.
- The ends are labelled in cm with a decimal comma.
- A small fridge outline grows as the handle moves, next to a 180 cm person marker.
- Built-in keeps the niche-height number input. That is the measurement people have. The tolerance logic stays.
- A live line under the slider: "Atbilst 31 ledusskapis" (31 fridges match).

**3.3 Household size and priorities** stay; they are soft and they already work.

**3.4 "Kurus zīmolus tu apsver?" (which brands are you considering?)**
- Optional and skippable with "Jebkurš zīmols" (any brand).
- Brand chips with counts, sorted by availability. Logos are not used: shop names and brands are configuration, and logo licensing is unclear.

**3.5 "Cik vēlies tērēt?" (how much do you want to spend?)**
- A two-handle price slider above a small histogram of real prices for the chosen form and height, so the user sees where the products are.
- Defaults are the middle 60 % of that distribution.
- The fixed 500, 800 and 1200 € steps become quick presets under the slider. The SEO landing pages `/kategorija/fridge/[budget]` keep working: the budget in their URL becomes the maximum.

**3.6 Never a dead end.** If a choice would leave 0 matches, the screen says so before the user moves on: "Šajā cenu robežā nav neviena — paplašināt līdz 550 €?" (nothing in this price range — widen to €550?).

## Phase 4 — Results you can adjust in place

**4.1 Filter bar** under the title
- One chip per active filter: "Standarta", "170–205 cm", "350–500 €", "Bosch, Samsung", "No Frost".
- Tapping a chip opens a bottom sheet on mobile, or a popover on desktop, with the same control as in the flow (slider, cards, brand chips) and a live "Rādīt 18 rezultātus" (show 18 results) button.
- Changes update the URL and re-rank immediately, with no full restart. "Mainīt atbildes" (change answers) remains for the full flow.

**4.2 Smart relax suggestions**
- When there are fewer than 3 picks, the code finds the smallest change that adds options and offers it as one tap:
  - "+ 4 varianti, ja budžets līdz 550 €" (4 more options with a budget up to €550)
  - "+ 7, ja augstums līdz 190 cm" (7 more if the height limit is 190 cm)
  - "+ 3, ja arī Beko" (3 more if Beko is included)
- These are computed by `countMatches`, so they are always true.

**4.3 "Vērts apsvērt"** (the 2.5 card) sits below the three picks and above the refurbished block. It is clearly separate and never mixed with refurbished offers.

**4.4 Explain every exclusion.** "Kā mēs izvēlamies un ranžējam?" gains a line that lists how many products each filter removed. This makes the logic visible.

**4.5 Accessibility**
- Sliders are native `input type="range"` pairs with labels and keyboard steps, plus number fields for exact entry.
- Touch targets are at least 44 px and contrast at least 4.5:1.
- The bottom sheet traps focus and closes with Esc.

## Phase 6 — Every category, not just fridges

Phases 0–2 and 4 are category-agnostic code. They apply to all 33 subcategories as soon as each one has its data defined. Phase 3 was written for fridges. This phase applies the same principles to every subcategory, based on a review of `data/categories.json`.

### 6.1 What the review found (same pattern in every category)

1. **Measurable things are asked as buckets.** Examples:
   - washer capacity 7/9/10 kg and "slim/standard" depth;
   - dish width 45/60;
   - hood width 50/60/90;
   - microwave volume 20/25/30 L;
   - freezer size small/mid/big;
   - air fryer portions;
   - mini oven volume 20/35 L.

   A bucket hides the real limit ("my niche is 44 cm deep") and fails the same way the fridge height did.
2. **No question says which attribute it filters on.** A hard filter matches option values against product `tags`, and scraped products have no tags. So every hard filter in every category passes everything as "unconfirmed", exactly like the fridge case.
3. **Type questions are text-only.** There are 35 hard choice questions with 90 options in total, for example:
   - freezer: chest, upright, built-in;
   - washer: front, top, combo;
   - vacuum: robot, stick, corded;
   - coffee: automatic, capsule, manual;
   - juicer: slow, centrifugal, citrus.

   Each is a choice a picture explains faster than a sentence.
4. **Things that decide fit or running cost are missing.** Examples:
   - a garage freezer needs a climate class rated for an unheated room (SN/T);
   - a hood should be at least as wide as the hob;
   - a dryer that stacks on a washer needs matching width and a stacking kit;
   - washers and dishwashers use water as well as electricity;
   - capsule coffee costs several times more per cup than beans;
   - vacuums need bags or filters.
5. **Compare rows are labels, not attributes.** `compare_row_labels` such as "Priekšrocības" or "Piemērots" have no attribute behind them, so the comparison and the upgrade delta (2.8) have nothing to compare.
6. **Budget steps are fixed per category.** For example, the €30/60/120 kettle steps are fine as presets, but they are the only way to say a price.

### 6.2 One data definition per subcategory (`data/attributes.json`)

For every subcategory, list its key attributes with:
- unit and normalisation (cm, L, kg, dB, W, m³/h, min);
- whether it is **fit-critical** (decides whether the product fits or works at all) or a **comfort** attribute;
- the source order (EPREL → spec table → same EAN → Claude → web);
- which question and compare row use it.

This replaces `NUMBER_FILTERS` hard-coded in `filters.ts`. It also turns `compare_row_labels` into real attributes and drives the delta text, the "Vērts zināt" notes and the coverage report. Tags are derived from attributes by code (Phase 1.1), so hard filters finally have data to match.

| Subcategory | Fit-critical | Comfort and value |
|---|---|---|
| fridge | form, install, height, width, depth (built-in: niche height) | volume, energy class + kWh, noise, No Frost |
| freezer | form, install, height (built-in), **climate class** for a garage | volume, energy + kWh, No Frost, fast freeze |
| washer | loading (front/top), **depth**, width, washer-dryer combo | capacity kg, spin rpm, energy + kWh, **water L/cycle**, noise, steam |
| dryer | type (heat pump/condenser), **stackable + kit**, depth | capacity kg, energy + kWh, noise |
| dish | install, **width**, height (built-in) | place settings, noise, energy + kWh, **water**, third basket, auto-open drying |
| hob | type, **cut-out width/depth**, **power connection** (1- or 3-phase, gas type) | zones, flexi zone, bridge, booster |
| oven | **niche height × width** (60 or compact 45 cm) | volume L, cleaning (pyrolysis/catalytic), steam, Wi-Fi, energy class |
| hood | install, **width ≥ hob width** | airflow m³/h, noise dB, extraction or recirculation, **filter cost** |
| micro | install, **niche size** (built-in) | volume L, grill, combi, power W |
| vacuum | type, mop | run time vs floor area, suction, noise, pet brush, HEPA, **bags/filters cost**, mapping and self-empty (robot) |
| steamclean | type | heat-up time, tank L, accessories |
| coffee | type (automatic/capsule/manual) | milk system, **cost per cup**, pressure, grinder, cups per day |
| grinder | burr or blade | grind range (espresso to filter), noise |
| iron, steamer | type | steam g/min, anti-calc, weight |
| small kitchen (kettle, blender, handblender, foodproc, mixer, chopper, mincer, scale, knife) | type (corded/cordless, jug/personal …) | power W, capacity L, material, accessories |
| cooking (grill, toaster, sandwich, airfryer, breadmaker, minioven) | type, slots, **external size** (minioven) | capacity L or portions, programmes, power W |
| healthy (juicer, dehydrator, vacuumsealer) | type | tray area or capacity, speed rpm, wet mode |

### 6.3 Questions: pictures for types, ranges for measurements

- **Picture cards for every hard choice question.** That is 35 questions, each card a simple lime line drawing in one shared style (Phase 3.1). Where size matters (freezer, washer, dryer, dish, oven, micro, mini oven), drawings are to scale with the 180 cm person marker.
  - The drawings are stored as data: `options[].illustration` in `categories.json`, with SVG files in `public/illustrations/`.
  - About 90 drawings in total, made once, reused in the flow, the filter bar and landing pages.
- **Ranges replace buckets wherever the value is measurable.**
  - washer and dryer depth (with "līdz 45 cm" as a preset), capacity in kg;
  - dish, hob and hood width;
  - oven and microwave niche;
  - fridge and freezer height;
  - volume in L for microwave, mini oven and air fryer.

  Buckets stay only where they describe intent, not size: "how often", "what for", "household size".
- **Cross-question rules in data**, for example `{"hood.width": ">= hob.width"}`. If the user recently searched for a hob, the hood flow pre-fills its width and says so: "Plīts virsma 60 cm → nosūcējs vismaz 60 cm" (60 cm hob → hood at least 60 cm).
- **New questions where fit is decided:**
  - freezer: "Kur stāvēs?" (where will it stand?) with a garage option → filters by climate class;
  - dryer: "Uz veļas mašīnas?" (on top of a washer?) → stackable and width match;
  - hob: "Kāds pieslēgums?" (which power connection?) with 1-phase, 3-phase, and "nezinu" (don't know) with help;
  - dish built-in: niche height.
- **Brands:**
  - Large appliances (fridge, freezer, washer, dryer, dish, oven, hob, hood, coffee, vacuum) get the optional brand step (2.4).
  - Small appliances skip it in the flow, keeping 3–4 questions in total, and offer brands only as a filter chip on the results page.

### 6.4 "Vērts zināt" advice per category (2.7 generalised)

Every running cost uses a configurable price shown in the "Kā mēs izvēlamies…" panel:
- electricity, default 0,25 €/kWh;
- water and sewage, default 3,5 €/m³ (Riga water tariff, to be confirmed);
- coffee beans and capsule prices.

| Category | The trade-off worth telling |
|---|---|
| fridge, freezer | energy class payback; volume per € |
| washer | energy + **water** payback; "9 kg par +25 €" (9 kg for +€25) for big households |
| dryer | **heat pump vs condenser**: "Par +90 € — siltumsūknis, ~60 € mazāk elektrībai gadā, atmaksājas ~1,5 gadā" (for +€90, heat pump, ~€60 less electricity a year, pays back in ~1,5 years) |
| dish | energy + water payback; noise for open-plan kitchens |
| oven | pyrolysis convenience vs its energy use per cleaning |
| hood | recirculation **filter cost per year** vs extraction; noise at normal speed, not booster |
| vacuum | **bags or filters per year**; robot mapping vs random navigation for large areas |
| coffee | **cost per cup**: "Kapsulas ~0,45 €/krūze, pupiņas ~0,15 € → pie 4 krūzēm dienā automāts atmaksājas ~10 mēnešos" (capsules ~€0,45 per cup, beans ~€0,15 → at 4 cups a day an automatic machine pays back in ~10 months) |
| small appliances | power vs task ("blenderim ledum vajag ≥ 1000 W", a blender needs ≥ 1000 W for ice); capacity vs household |

Payback is shown only when it is shorter than the product's typical life: 10 years for large appliances, 5 for small. If a note has no real numbers behind it, it is not shown.

### 6.5 Category sanity rules (Phase 1.4 generalised)

Each subcategory gets the following in `data/attributes.json`:
- a required word stem in the name or breadcrumb (`ledusskap`, `veļas mašīn`, `putekļsūc` …);
- a plausible price range;
- one required plausible attribute.

This stops shop mis-filing everywhere (the m79 toys under coffee machines) and spare parts and accessories appearing as products (kettle filters, vacuum bags).

### 6.6 Rollout order

The same code serves every category. What differs per category is data: attributes, sanity rules, illustrations, advice models and question edits.

| Batch | Subcategories | Why first |
|---|---|---|
| 1 | fridge | owner test case; pattern reference |
| 2 | washer, dish, dryer | EPREL data, water + energy advice, highest ticket after fridges |
| 3 | vacuum, coffee | most searched, strong running-cost advice |
| 4 | oven, hob, hood, micro, freezer | built-in fit rules and cross-question rules |
| 5 | the other 22 subcategories (small appliances, iron, steamer, steam cleaner, grinder) | short flows; picture cards + ranges + sanity rules in one pass |

Each batch is done when, for its subcategories:
- at least 95 % of in-stock products have every fit-critical attribute (`/api/status` coverage);
- an e2e test runs one realistic search;
- the real-data review sheet (Phase 5) has been checked.

## Phase 5 — Proof

- **Unit tests:**
  - range filters, the missing-data policy and the pick spread;
  - the card-text rules (2.8);
  - `countMatches`, the relax suggestions and the "Vērts apsvērt" rule;
  - spec parsers on saved real pages.
- **e2e:**
  - the owner's exact case: a standard fridge, height up to 178 cm, budget €350–500. No result may be under 150 cm or under €350;
  - adjusting a chip on the results page;
  - a dead-end prompt;
  - keyboard use of the sliders;
  - axe checks at 360 px and on desktop.
- **Real-data check:** after an ingestion run, a review sheet of the top 3 for ten common fridge searches. Each pick shows its height, form, price and data source (spec table, EPREL or Claude).
- **Release:** merge only after the owner confirms ingestion is done, or after Phase 0 has made deploys safe.

## Order and size

| Step | Content | Size |
|---|---|---|
| 1 | Phase 0 (deploy-safe ingestion) | small |
| 2 | Phase 1.1 + 1.4 + 1.5 (spec tables, sanity check, coverage) | medium |
| 3 | Phase 2.1–2.3 + 2.6 + 2.8 (ranges, missing data, picks, counts, truthful card text) | medium |
| 4 | Phase 3 (visual fridge flow) | medium |
| 5 | Phase 4.1–4.2 + 4.4 (editable results) | medium |
| 6 | Phase 1.2–1.3 + 2.7 (EPREL, same-EAN fill, Claude and web lookup, advice notes) | medium; EPREL needs the key |
| 7 | Phase 2.4–2.5 + 4.3 (brands, "Vērts apsvērt") | medium, needs the brand table reviewed |

Steps 1–5 fix everything reported except brands and need no new keys. Fridges come first. Phase 6 then rolls the same code out to every other category in five batches. Only data changes per category: attributes, illustrations, questions and advice models.

## Decisions

Settled on 18 Oct 2026:
- **AI use.** AI provides the data: extraction, web lookup and the brand table draft. Code does the choosing: filters, picks, the "Vērts apsvērt" card and the advice notes. `CLAUDE.md` rule 4 and the honesty panel stay true.
- **Missing data.** The goal is complete data (Phase 1). Whatever remains after every source is not shown as a pick.
- **Budget.** A min–max range replaces the fixed steps, which stay as presets. `PRODUCT_SPEC.md` §2.2 is updated with this work.
- **EPREL.** The key has been requested; it goes in as `EPREL_API_KEY` when it arrives.

Still open:
- The brand table draft (2.5) needs one review by the owner before it ships.
