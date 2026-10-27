# Three options the shopper can trust: selection and argumentation

> **Status (24 Oct 2026): implemented** (all recommendations agreed by the owner). Code: `src/domain/confidence/confidence.ts` (roles, verdicts, catch, why-not, reviews, price confidence, coverage), `src/domain/knowledge/` + `data/knowledge.json`, `src/app/[locale]/rezultati/confidence-text.ts`; e2e in `tests/e2e/confidence.spec.ts` and the every-category honesty checks in `categories.spec.ts`. Differences from the plan:
> - All PRs were delivered as one change; step 7 (review the numbers) waits for four weeks of traffic.
> - The spare-parts line (B4) is **not shown**: EUR-Lex could not be read to verify the years per part, so per the plan it stays off until verified.
> - Noise words ("ļoti kluss") are not used; claims are relative to the products actually on offer ("klusākais šajā budžetā"), which needs no external threshold.
> - "Kāpēc ne šie?" lines name the product, price and reason; they do not link to a card.
> - Measured: results views ending in a shop click and the confidence question's answers (admin "Statistika" → "Pārliecība"). Time to click and repeat searches within 7 days are not measured yet (they need a visitor identity we do not keep).

Owner, 24 Oct 2026: "When three products are provided, the user needs to feel safe that they do not need to search for alternatives. Currently only electricity and noise levels are compared; we need a deeper connection. Think as Steve Jobs."

The test this plan has to pass: a shopper reads the three cards on a phone, understands why each one is there and what its catch is, and buys, without opening another tab. Today the page is honest and well-filtered, but it argues like a spec sheet. This plan makes it argue like a knowledgeable friend who has already done the shopping.

## 1. What a shopper silently asks, and what the page answers today

Trust is not a badge. It is four questions answered before they are asked. The audit below is of the live results page (`src/app/[locale]/rezultati`, `src/domain/ranking`, `src/domain/delta`, `src/domain/advice`).

| The silent question                                                  | What the page does today                                                                                                                                                                                                                                                                                                                                                                                                                       | Gap                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **"Did you look at everything?"**                                    | The lead says "31 preces atbilst". "Šoreiz filtri atsijāja: …" and the ranking rules sit in the collapsed "Kā mēs izvēlamies" panel. "Citi varianti" lists the rest on request.                                                                                                                                                                                                                                                                | How many products and shops were searched, and when, is never said up front. Coverage is the first thing a doubtful shopper wants, and it is hidden.                                                                                                                                                             |
| **"Why these three, and why not the one I saw in the shop?"**        | Picks are the best value overall plus the best in the lower and upper price thirds, none dominated. The upgrade box lists gains and trade-offs against the cheaper card. "Kāpēc der" echoes matched answers.                                                                                                                                                                                                                                    | The three roles are price positions ("Budžeta variants") that say what a product costs, not why anyone would want it. Nothing says why the obvious candidates (the cheapest, the famous brand, the shop's bestseller) are **not** here. The comparison is only against the other two cards, never the market.     |
| **"Will I regret it in a year?"**                                    | Compared attributes per category (`compare` in `categories.json`): for a fridge install, doors, three dimensions, volume, energy class, noise, No Frost. Brand reliability (38 brands, graded 1–5 from independent surveys, with sources) enters the score and the upgrade box. Energy over 10 years, EPREL label links.                                                                                                                         | What decides satisfaction after purchase is mostly absent: reliability stated positively, warranty, model age, programme times, residual moisture, water, mapping type, bin size, consumables, cleaning effort, spare parts. The "Trilio vērtējums" shown in the panel is **null for every real product** (see 1.1). |
| **"Is this the right price and moment?"**                            | Lowest price across shops by EAN, other shops' prices, the 30-day low (Omnibus), delivery date.                                                                                                                                                                                                                                                                                                                                                 | Price history exists in `price_snapshots` but is only used for the 30-day line. Nothing says "stable for a month", "lowest we have seen" or "all three shops within 5 €", which is what ends the search for a better deal.                                                                                        |
| **"What's the catch?"**                                              | "Bet: …" in the upgrade box, "Nav zināms: …" for unknown attributes.                                                                                                                                                                                                                                                                                                                                                                            | The catch is relative to the cheaper card, so the budget pick has none, and the shopper finds it elsewhere ("ah, it has no water dispenser").                                                                                                                                                                     |

### 1.1 Facts the audit turned up

- **The product rating does not exist in production.** `products.rating` is set only by the sample adapter (`src/services/ingestion/sample.ts`); every scraped product has `rating: null` (`common.ts`), so the score uses `DEFAULT_RATING = 70` for all, the card hides the line, the compare row reads "nav zināms", and the "rating" delta items never fire. The panel text "veikala vērtējums" promises something the page does not have. ROADMAP open question 3 (the rating method) was never decided.
- **EPREL gives us far more than we store.** The records we already fetch (`src/domain/catalog/__fixtures__/eprel.json`, real records) carry `onMarketStartDate` and `onMarketEndDate` (model year, discontinued), `programmeDurationRated`, `waterCons`, `spinClass`, `moistureRated`, `noiseClass`, `condensationEfficiencyClass`, `lowNoiseAppliance`, and in newer labels `guaranteeDuration`, `repairabilityClass` and `webLinkRepairInstructions`. `eprel.ts` maps a dozen fields; the rest is thrown away.
- **Shop pages carry reviews we do not read.** The scraper parses the schema.org `Product` node (`scrape/jsonld.ts`) for name, brand, EAN, price and stock; `aggregateRating` in the same node is ignored.
- **Priorities are hidden.** "Kas vēl svarīgi?" is a results-page chip (correct per the Jobs rules: it does not decide fit or price), but it sits in a row of chips and most shoppers never open it. Without a stated priority the page cannot connect the picks to the person.
- **The comparison vocabulary is thin by design, not by data.** `compare` keys per category average five, and for small appliances it is `power_w` plus one or two others. The upgrade box can only say what `compare` lets it say.

## 2. The principle

Steve Jobs's product test was what a thing leaves out, and whether it speaks the customer's language. Applied to this page:

1. **Lead with the verdict, prove it with numbers.** The first line of a card is a sentence a friend would say ("Četriem cilvēkiem īstais izmērs, klusākais no trim, un zīmols, kas kalpo"). Numbers follow as proof. Today the card leads with the name and the price, and the reasoning is a list of deltas.
2. **Three different answers, not three price points.** Each pick holds a role it has earned against every product in budget, not just against the other two. If one product earns every role, show one card and say so. Fewer, better things.
3. **Show what was considered and rejected.** Confidence comes from seeing the losers and the reason each one lost. One honest line per rejected candidate does more than any badge.
4. **Name the catch first.** Every pick states what it is not, against the best available, before the shopper finds it in another tab.
5. **Only claims with data behind them, and the source one tap away.** When we do not know, we say so. No adjective without a number. This keeps the "Kā mēs izvēlamies" panel true and the rule that commission never touches ranking.
6. **AI drafts data, code decides and speaks.** Category knowledge, deeper attributes and the brand table are drafted by Claude and reviewed by the owner (the process already used for `brands.json`). Picks, roles, verdicts, catches and "why not" are deterministic code with unit tests (CLAUDE.md rule 4, `docs/LLM.md`). No model writes a recommendation at runtime.
7. **Remove before adding.** A card on a 360 px phone is: role, verdict, three proofs, one catch, price and shop. Everything else (compare table, glossary, sources, the full list) is one tap away.

## 3. Changes

Grouped by what they need. A–D are product changes; E is how we know it worked.

### A. The story of the three (no new data)

**A1. Coverage line.** Under the title, from numbers `rank()` already returns plus the store count and the last ingestion time:

> Izskatījām 47 ledusskapjus 6 veikalos (atjaunots šodien 08:40). 31 der tavai virtuvei un budžetam. Šie trīs ir labākie — un lūk, kāpēc.
> _(We looked at 47 fridges in 6 shops, updated today 08:40. 31 fit your kitchen and budget. These three are the best, and here is why.)_

The shop names come from the `stores` table (configuration, never code) and are listed in the panel. The time comes from the latest `offers.last_seen_at`.

**A2. Roles instead of price tiers.** `pickThree` keeps its logic (best value, spread over the range, no dominated pick), but the pills say **why** a card is there. A role is a predicate over the whole in-budget pool, deterministic and tested:

| Role (LV / EN)                                                       | Earned when                                                                                                                                                                                     |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Saprātīgā izvēle** / The sensible choice                           | Best `valueScore` in budget. Carries "Trilio ieteikums" when the existing margin rule holds.                                                                                                     |
| **Ja {prioritāte} ir galvenais** / If {priority} comes first         | Leads the in-budget pool on the shopper's first priority (quietest dB, lowest kWh, largest volume, longest run time, …) by at least the attribute's `minDelta`. Without a priority: the category's first `decides` attribute (C1). |
| **Lētākais, ko paši pirktu** / The cheapest we would buy ourselves   | Cheapest in budget that passes a quality floor: fit data known, brand grade ≥ 3 or ungraded with every `decides` attribute known, no `decides` attribute in the bottom quarter of the pool.         |
| **Kalpos ilgāk** / Built to last                                     | Highest brand grade in the pool, and (when known) the longest warranty or the newest model year (B2, B3). Only when it is not already the sensible choice.                                        |

Rules: a pill appears only when the role is genuinely earned against the pool; a product may earn several roles, in which case fewer cards are shown and the lead says "Šoreiz viens variants pārspēj visus pārējos" (one option beats all the others this time); cards stay sorted by price; the 10 % tier-gap rule and dominated-pick rule stay. Price tiers remain as the sort order and as the `tier` data attribute the e2e suite checks.

**A3. The verdict line.** One sentence per card, first on the card, built by code from a per-category template grammar in the message files (LV and EN) and the shopper's own answers. Every verdict must echo at least one answer and contain at most two numbers. Patterns, with the data each one needs:

- Fit from the household answer: "Četriem cilvēkiem 300 L ir īstais izmērs." (`household` answer × `volume_l` thresholds from C1).
- Leads on the priority: "Klusākais no trim: 36 dB — klusa istaba." (`priorities=quiet`, `noise_db`, threshold words from C1).
- Reliability stated positively: "Bosch šajā kategorijā: uzticamība 4/5 (OCU 2025, Altroconsumo 2025)." (`brands.json`, already has sources).
- Cost of ownership: "Par 40 € dārgāks nekā lētākais, bet 10 gados par 60 € lētāks elektrībā." (existing energy code).
- Running cost in daily life: "Eko programma 3 h 29 min; ātrā 15 min ikdienai." (B2, C2).

When data is thin the verdict says so: "Par šo zinām mazāk: veikals nenorāda trokšņa līmeni." A test fails if a pick renders without a verdict.

**A4. "Kāpēc ne šie?" (Why not these?).** Below the picks, up to four products the shopper is most likely to meet elsewhere, each with one factual reason it is not a pick. Chosen deterministically from the pool and the excluded products:

- the cheapest product in range that was not picked;
- the product of the best-graded brand that was not picked;
- the product listed in the most shops (a proxy for what the shopper will see first);
- the product with the best reviews (once B1 exists).

Reasons come from the data that excluded it: "15 € dārgāks par «Saprātīgo izvēli» un nevienā parametrā labāks" (dominated), "186 cm; tavs maksimums 178" (failed a fit answer, with the shopper's own number), "virs budžeta par 240 €", "veikals nenorāda energoklasi un troksni" (unknown data), "zīmolam nav neatkarīgu uzticamības datu", "modelis vairs netiek ražots" (B2). Each links to its card in "Citi varianti". Nothing is said about a product that is not in our data.

**A5. The catch, against the market.** The "Bet:" line is computed against the best in-budget product on each of the shopper's priorities and the category's `decides` attributes, not only against the cheaper card:

> Bet: nav ūdens dozatora; klusākais pieejamais (34 dB) maksā +170 €.

So the budget pick also gets a catch, and the shopper learns what the extra money would buy anywhere, which is exactly the question that sends them to another site.

*Revised 27 Oct 2026 (owner, after shopper feedback):* comparing every card with the single best product at the top of the budget made all three cards repeat the same "+300 €" line. The catch is now the **nearest fair step up**: the cheapest in-budget product that is clearly better on that attribute (`catchFor`). A step costing more than half the card's price (`CATCH_MAX_SHARE`) is skipped for the next attribute, and no product is named on two cards (`catchesFor`). The line names that product and links to its card ("Bet: trokšņa līmenis 39 dB; ar 36 dB — Samsung RB38, maksā +40 €."); a named product that is not already on the page gets a card under "Minēti salīdzinājumam". Still deterministic code: no model chooses the step or writes the numbers.

*Revised again the same day (owner):* the first revision could name a cheaper product ("then why not that one?") and even a sibling pick, and card 1's step cost +111 € for 18 min. Now: a catch points only upward (same price or more, at most a quarter over); never at another pick; a cheaper product that wins on an argued point goes to "Kāpēc ne šie?" as a `better` entry with its reason; the upgrade box says "Iegūsti:" / "Zaudē:" (accusative and genitive forms in `delta.lose` and `delta.featureAcc`), so "Bet:" appears once per card; the sentence is "Bet: darbības laiks 90 min. Hisense HVC646541A ar 108 min maksā par 40 € vairāk." with whole euros and per-feature "ar"/"bez" phrases (`delta.featureWith`, `delta.featureWithout`); a card reached by the link flashes its ring (CSS `:target`); the named products sit under "Soli augstāk".

**A6. Priorities in plain sight.** Under the lead, one row of pills: "Kas tev svarīgāk? Klusums · Patēriņš · Tilpums · Vienalga" (what matters more to you?). One tap re-ranks and relabels the roles; the chip sheet stays for multi-select. It is the same `priorities` question and the same URL state, only visible. Priorities stay out of the flow (Jobs rule 1): they refine, they do not decide fit or price.

**A7. The panel tells this search's story.** "Kā izvēlējāmies šos trīs" becomes five numbered steps with this search's numbers: searched N products in these shops; M met your answers (list what each answer removed); K were in budget; L had complete data; ranked by value with these factors; the three roles above. The generic paragraphs about commission, energy price and refurbished stay below.

### B. Evidence (new data, nearly all of it free)

**B1. Reviews from the shops' pages.** Read `aggregateRating` from the same JSON-LD node the scraper already parses; store `offers.rating_value` and `offers.rating_count`; aggregate per product across shops weighted by count. Shown only with 10 or more reviews in total, always with the count and the shops: "4,6 ★ · 128 atsauksmes 3 veikalos". The first ingestion run reports coverage per shop; if fewer than a third of products have reviews, the line is shown where available and never implied elsewhere. Reviews are "veikalu atsauksmes", never presented as verified by Trilio (UCPD).

**B2. Everything EPREL already tells us.** Extend `eprel.ts` and the attribute catalogue with the fields we fetch and drop:

| EPREL field                                | Attribute          | What the card can say                                                                                                                                   |
| ------------------------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `onMarketStartDate`                        | `model_year`       | "2025. gada modelis", or "Tirgū no 2019. gada — veikali to izpārdod" (both honest; the second is often a good deal, and we say so).                       |
| `onMarketEndDate`                          | `discontinued`     | "Vairs netiek ražots" as a catch, and as a why-not reason.                                                                                              |
| `programmeDurationRated`                   | `programme_min`    | "Eko programma 3 h 29 min" for washers, dishwashers and dryers; a compare row and a delta item.                                                          |
| `waterCons`                                | `water_l_cycle`    | Already an attribute; add it to `compare` for washer and dish and to the 10-year cost (water price from `DEFAULT_COSTS`).                                 |
| `spinClass`, `moistureRated`               | `moisture_pct`     | "Pēc centrifūgas veļa 53 % mitra" — the number behind "dries faster in the dryer".                                                                        |
| `noiseClass`, `lowNoiseAppliance`          | `noise_class`      | Words beside the dB figure.                                                                                                                             |
| `condensationEfficiencyClass`              | `condensation_cls` | Dryers: how much moisture ends up in the room.                                                                                                          |
| `guaranteeDuration`, `repairabilityClass`  | `warranty_months`, `repairability` | Present in the newer label regulations; stored when the record has them, shown only then.                                                       |

**B3. Warranty per product.** Add the spec-table label "Garantija" to the attribute catalogue (`warranty_months`), merge EPREL's `guaranteeDuration` and the brand table's `warrantyYears`/`extendedWarranty`. The card says "Garantija 2 gadi (likumā noteiktā)" or "5 gadi ražotāja garantija", and for extended ones "10 gadu kompresora garantija, reģistrējot — Latvijai nav apstiprināts" exactly as the table caveats it.

**B4. Reliability stated on every card, not only in deltas.** "Uzticamība 4/5 šajā kategorijā" with the sources in the panel (the data and sources exist in `brands.json`). An ungraded brand is a catch: "Zīmolam nav neatkarīgu uzticamības datu." Spare-parts obligations are a category fact worth one line: EU ecodesign rules since March 2021 oblige manufacturers to supply spare parts for 7–10 years for refrigerators ((EU) 2019/2019), washing machines ((EU) 2019/2023) and dishwashers ((EU) 2019/2022), and for tumble dryers from July 2025 ((EU) 2023/2533). The exact years per part are to be verified against the regulation text before the line ships; until then it is not shown.

**B5. The rating: decide, then show the parts.** Recommendation: **do not publish a composite number.** A single "8,6/10" nobody can check is what every comparison site does, and ours would mostly be the brand grade in disguise. Keep the score internal to ranking and show its parts on the card: reliability grade with source, reviews with count, the spec facts, the warranty. Remove "veikala vērtējums" from the panel until it is true. If the owner prefers a visible number, it is a documented composite (brand grade, shrunk review average, spec points, warranty, data completeness) with a one-tap breakdown "Kā sanāk 8,6?". Either way ROADMAP question 3 is closed.

**B6. Price confidence from the snapshots we already keep.** One line per card from `price_snapshots`:

- "Cena stabila 30 dienas; visos 3 veikalos ±5 €." (nothing better is hiding in another shop);
- "Zemākā cena, ko esam redzējuši." (only when true over the recorded history);
- "Pirms 12 dienām bija 489 € — ja nesteidzies, saglabā, un paziņosim." (Omnibus-safe: we already store the 30-day low; this adds the date and the wishlist nudge, no countdown, no urgency).

### C. Category depth: what decides whether you are happy a year later

**C1. A knowledge file, `data/knowledge.json`, one entry per subcategory**, drafted by Claude from independent reviews and consumer-organisation tests, reviewed by the owner, every entry with sources, the same process as `brands.json`:

- `decides`: the three to five attributes that matter most in daily use, in order, each with a plain-language why. Fridge: noise ("strādā arī naktī"), volume per household, No Frost, compressor type, door reversibility. Washer: programme time, noise and vibration, capacity, inverter motor, residual moisture. Robot vacuum: mapping type, battery vs area, bin size and self-emptying, obstacle handling, consumable cost. Coffee: cost per cup, milk-system cleaning, grinder, cup height.
- `thresholds`: the words behind the numbers, so the card can say "ļoti kluss" and mean it: for example fridge noise ≤ 36 dB "ļoti kluss", 37–40 "kluss", 41–44 "dzirdams blakus istabā", ≥ 45 "skaļš". Each threshold cites where it comes from.
- `glossary`: one line per feature in the shopper's language: "Inverter kompresors: maina ātrumu, nevis slēdzas iekšā un ārā — klusāks un kalpo ilgāk."
- `watchOut`: the common regrets after purchase for the category, each tied to an attribute so code can check it ("durvis nevar pārkārt" → `door_reversible = false`).
- `consumables`: cost per year with sources (bags, filters, descaler, capsules), extending `DEFAULT_COSTS`.
- `lifeYears`, `sparePartsYears`: with the regulation reference (B4).

Schema in `src/domain/knowledge/schema.ts`, validated at load like the catalog; a test fails if a `decides` attribute is not in the subcategory's `key` list.

**C2. Deeper attributes per category.** Extend `attributes.json` `key` with the `decides` attributes we do not capture yet, and the `compare` lists with the ones worth a row. The existing pipeline fills them: spec tables (labels added to the catalogue), EPREL (B2), then Claude extraction for the gaps (already built, gated by `FEATURE_LLM_EXTRACT`, Haiku, capped; a product costs a fraction of a cent, and a product already complete is skipped). Examples:

| Category     | New attributes                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------ |
| fridge       | `inverter_compressor`, `door_reversible`, `fast_freeze`, `water_dispenser`, `humidity_drawer`, `model_year`         |
| washer       | `inverter_motor`, `quick_wash_min`, `programme_min`, `auto_dose`, `child_lock`, `delay_start`, `moisture_pct`       |
| dish         | `programme_min`, `half_load`, `cutlery_tray`, `water_l_cycle` (in compare), `delay_start`                           |
| dryer        | `programme_min`, `condensation_cls`, `heat_pump` (from `dryer_type`), `drum_light`                                   |
| vacuum       | `suction_pa`, `bin_l`, `mapping` (lidar / camera / gyro / random), `self_empty`, `carpet_detect`, `weight_kg`      |
| coffee       | `grinder_type`, `milk_type` (auto / manual / none), `cleaning_program`, `cup_height_cm`, `hopper_g`                |
| kettle, iron | `boil_min` for 1 L, `cordless_base`; `steam_boost_gmin`, `auto_off`                                                 |

Rollout in the same batches as `docs/FILTERS_PLAN.md` §6.6: the five energy-label categories first (they get most of B2 for free), then cleaning and coffee, then the rest.

**C3. A compare table in groups, with words.** Rows grouped as "Ikdienā" (noise, programme time, capacity, features), "Izmēri", "Izmaksas 10 gados" (purchase, electricity, water, consumables), "Uzticamība un garantija", "Modelis un cena". Each number carries its threshold word ("36 dB · ļoti kluss") and each feature name opens its glossary line in an accessible `<details>`. "Rādīt tikai atšķirības" stays.

**C4. "Vērts zināt" learns the category's regrets.** `watchOut` entries become notes when the data confirms them for a pick: "Šim durvis nevar pārkārt — pārbaudi, uz kuru pusi jāatveras." Same rules as today: at most two notes, only with data, never a guess.

### D. The friend's voice: a copy system, not copywriting

- Templates live in the message files (LV first, EN alongside, per CLAUDE.md), grouped by category family (cooling, laundry, dishes, cleaning, coffee, small appliances, personal care). Code picks a template by the data available and fills it; it never improvises.
- Rules a review checks: at most two numbers per sentence; the shopper's own answer or number appears in every verdict; no adjective without a number or a source behind it ("uzticams" always with "4/5"); the catch is a fact, not an apology.
- Honest fallbacks are templates too: "Par šo zinām mazāk: …", "Šoreiz neviens nav skaidri labāks — ja gribi klusāko, ņem A; ja lētāko, B."
- Latvian grammar as in CLAUDE.md: cases, decimal comma, space before €; the English version keeps the same claims with English formats (already handled by the formatters).

### E. Proof that it works

- **Events** (GA4 and first-party, no personal data): `verdict_shown` per card, `why_not_opened`, `all_matches_opened` ("Citi varianti"), `priority_tapped`, `select_offer` (exists), `change_answers`.
- **The one question that matters**, at the bottom of the results and after a shop click-out returns: "Vai šie trīs deva pārliecību izvēlēties?" Jā / Nē, kaut kā pietrūka — with an optional one-line "kā?" stored like waitlist demand (no e-mail, no identity).
- **Metrics**, before and after per category, on the admin statistics page as a "Pārliecība" tile: share of results views that end in a shop click without opening "Citi varianti" or "Mainīt atbildes"; time from results to click; repeat visits to the same search within 7 days (the sign that the search went on elsewhere); saved searches; the yes-share of the question.
- **Honesty checks in e2e**, every category: every pick has a verdict and at least one proof; every role pill is earned (checked through data attributes against the page's own candidate data); every "why not" reason is verifiable from the page data; no composite number appears without a breakdown; axe passes.

## 4. What we will not do

- No model-written verdicts or recommendations at runtime. Prose comes from templates filled with data (CLAUDE.md rule 4, `docs/LLM.md`).
- No star rating without a count and a named source; no "popular", "bestseller" or "N people viewing" without data; no countdowns (CLAUDE.md rule 4, honest persuasion).
- No fourth card. If the roles collapse onto one product, we show fewer cards, not more.
- No 15-row spec table by default. The card is role, verdict, three proofs, one catch, price. Depth is one tap away.
- No claim about a product that is not in our data, including in "why not".
- No shop brand in code; shop names and counts come from configuration (CLAUDE.md rule 7).

## 5. Order of work

Each step is one PR with unit tests for every rule and the e2e checks in E, following the rule from `docs/FILTERS_PLAN.md`: data before logic, logic before experience.

| #  | PR                                                                                                                                                                      | Needs                              | Size |
| -- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ---- |
| 1  | **Measure and tell the story with today's data:** events and the confidence question (E), coverage line (A1), panel narrative (A7), "Kāpēc ne šie?" (A4), catch against the market (A5). | Nothing new                        | M    |
| 2  | **Roles and verdicts:** role predicates and pills (A2), verdict grammar and templates (A3, D), visible priorities (A6).                                                   | Owner decision on roles (§6)       | M    |
| 3  | **EPREL depth, warranty, price confidence, reliability line:** B2, B3, B4, B6; `compare` gains water and programme time for washers and dishwashers.                       | EPREL key already in Railway       | M    |
| 4  | **Reviews and the rating decision:** B1 in the scraper and ingestion, B5 as decided.                                                                                      | Owner decision on the rating (§6)  | S–M  |
| 5  | **Knowledge and depth, energy categories:** `knowledge.json` and C2 attributes for fridge, freezer, washer, dryer, dish; grouped compare table (C3); regret notes (C4).   | Owner review of the knowledge draft | L    |
| 6  | **Knowledge and depth, the rest:** cleaning and coffee, then kitchen small appliances, then personal care, in batches with their e2e checks.                              | PR 5 pattern                       | L    |
| 7  | **Review the numbers** from PR 1 after four weeks of PR 2–5 traffic; adjust templates and thresholds; write the findings into `docs/PRODUCT_SPEC.md` §3.                | Traffic                            | S    |

PRs 1 and 3 need no decisions and can start at once. PR 2 waits for one decision; PR 5 for one review.

## 6. Decisions needed from the owner

1. **Roles replace price-tier pills** (A2). The sort stays by price; the pills say why a card is there. Recommended: yes.
2. **No public composite rating** (B5): show the parts with sources instead of a "8,6/10". Recommended: yes; the alternative is a documented composite with a breakdown.
3. **"Kāpēc ne šie?" names real products** that were rejected, with the factual reason (A4). Recommended: yes; it is the strongest answer to "do I need to look elsewhere".
4. **Shop reviews on the card** (B1), labelled as the shops', with counts. Recommended: yes, with the ≥ 10 reviews rule.
5. **Priorities as a visible pill row** on the results page (A6), not only in the chip sheet. Recommended: yes.
6. **The confidence question** on the page (E). Recommended: yes; one tap, anonymous.
7. **Knowledge drafting by Claude with owner review** for `knowledge.json`, as for `brands.json` (C1). Recommended: yes; one draft per category batch, a few euros in total.
8. **Spare-parts and warranty lines** only after the regulation years are verified (B4). Recommended: yes.
9. **Electricity and water prices** behind every cost figure (ROADMAP 5, FILTERS_PLAN 6.4): keep 0,25 €/kWh and 3,50 €/m³ as configuration, show them in the panel, review twice a year. Recommended: yes.

## 7. What a card would say

Illustrative, with data the plan makes available; the English version follows the same templates.

**Fridge, 4 people, 178 cm niche, quiet first, 500–800 €**

> **Saprātīgā izvēle · Trilio ieteikums**
> Četriem cilvēkiem 300 L ir īstais izmērs; klusākais no trim (36 dB · ļoti kluss) un nav jāatkausē.
> ✓ Ietilpst: 177 cm, tavs maksimums 178
> ✓ Uzticamība 4/5 šajā kategorijā (OCU 2025, Altroconsumo 2025) · garantija 2 gadi
> ✓ Elektrība 10 gados ~ 280 € — par 60 € mazāk nekā lētākajam variantam
> Bet: nav ūdens dozatora; klusākais pieejamais (34 dB) maksā +170 €.
> **599 €** · Veikals A · cena stabila 30 dienas, visos 3 veikalos ±5 € · 2025. gada modelis

**Robot vacuum, 80 m², pets, 250–400 € (the owner's 23 Oct case)**

> **Ja tīrība bez uzraudzības ir galvenais**
> Lidar kartēšana — nepazaudē istabas 80 m² dzīvoklī; 150 min akumulators pietiek visai platībai vienā reizē.
> ✓ Birste dzīvnieku spalvām · HEPA filtrs
> ✓ Tvertne 0,5 L — iztukšo reizi 2–3 uzkopšanās
> ✓ Filtri un birstes ~ 25 € gadā
> Bet: par 17 dB skaļāks nekā lētākais; nav pašiztukšošanās stacijas (ar staciju: +180 €).
> **349 €** · Veikals B

**Kāpēc ne šie?**

> Zīmols X RB38… — 15 € dārgāks par «Saprātīgo izvēli» un nevienā parametrā labāks.
> Zīmols Y B3RCNE… — 186 cm; tavs maksimums 178.
> Zīmols Z RB… — veikals nenorāda energoklasi un troksni.
> Zīmols W CNsfd… — virs budžeta par 240 €.

Each line links to the product in "Citi varianti", where every one of the 31 is listed in the same order the picks were chosen.
