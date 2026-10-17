# Question review — `data/categories.json`

Review of every question in the guided flow (29 generic subcategories in `categories.json` plus the fridge and vacuum flows in `PRODUCT_SPEC.md` §2.2). The test for each question: **does the answer change which products are shown or how they rank, and can a shopper answer it without research?** A question that fails either test is wasted screen time on a phone.

Legend: ✅ keep · ✏️ change · ➕ add · ➖ remove · ⚠️ engine rule

Nothing here is applied to the JSON yet. Items marked **owner decision** change a product decision and need a yes; the rest I will apply once you say "go".

---

## Cross-cutting findings (apply to all subcategories)

1. ⚠️ **`any` / `Nezinu` under a hard filter must pass everything.** Dishwasher width, hood width and microwave use all have a hard-filter question with a "don't know / doesn't matter" option. The engine needs one reserved value (`any`) that never excludes; a validation test should fail CI if a hard-filter question lacks such an escape hatch.
2. ⚠️ **Hard filters on an additive feature must not exclude richer products.** Microwave "Tikai sildīšu" (heat only) is `hard_filter: true`; it must not exclude grill or combi models that also heat. Rule: a hard filter excludes products that *contradict* the answer, not products that *exceed* it. Mark such options `minimum: true` in the schema or make the question soft.
3. ⚠️ **Unknown attribute ≠ mismatch.** Partner feeds will often lack width, niche height or noise. A hard filter should exclude only when the attribute is present and contradicts; products with a missing attribute pass but get a "nav apstiprināts" note on the card. **Owner decision** (it affects trust in the "within budget, matches your needs" promise).
4. ➖ **"Dizains" options (kettle, toaster) cannot be scored.** No product attribute says "has design". They give the user a choice that silently does nothing. Replace with a material or form question that maps to data (see per-category notes).
5. ➕ **Priorities as a multi-select** work well in the fridge and vacuum flows. Dishwasher and washer would benefit from the same (pick up to 2) instead of a single "what matters most".
6. ✏️ **Order: type first, then usage.** Coffee and grinder ask usage before type; type is the hard filter and the more natural first question. Reorder.
7. ✅ **Budget → refurbished → urgency** as shared trailing questions is right. Suggest adding a "Cita summa" number input to the budget step so a shopper with 650 € isn't forced into 700 €. **Owner decision** (spec says 4 fixed steps).
8. ✅ Latvian copy is consistent (informal "tu", short titles, sublabels in brackets). Only wording fix: hob `g0` "Ko tieši meklē?" → "Kādu plīti vai virsmu meklē?" to match the other categories' pattern.

---

## Ledusskapji un saldētavas

### fridge (bespoke, from spec) ✅
The flow is good: type → niche height / size class → freezer → household → priorities → budget. Two additions:
- ➕ **Noise matters only when the kitchen opens onto the living room.** Instead of relying on the "quiet" priority, consider a yes/no "Vai virtuve ir savienota ar dzīvojamo istabu?" that boosts ≤ 38 dB. Optional; priorities already cover it.
- ➕ For `builtin`, also ask **door hinge type** (slide-on vs door-on-door) only if feeds carry it. Most do not; skip for Phase 1.

### freezer ✏️
- `g0` type ✅. ➕ If `builtin`, add niche height (showIf), same as fridges — the same return-rate argument applies.
- `g1` "Kur saldētava stāvēs?" ✏️ **make it a hard filter when the answer is `garage`.** A freezer without climate class SN or SN-T fails in an unheated room; this is a safety-of-purchase constraint, not a preference. `home` stays pass-through.
- `g2` volume ✅.

---

## Veļas mazgāšana un kopšana

### washer ✏️
- `g0` type ✅ (`combo` is a genuinely different product).
- `g1` household → kg ✅, good "why" note.
- `g2` bathroom space: ✏️ **skip when `g0 = top`** (top-loaders are already 40 cm; the question is redundant). showIf.
- ➕ Add a priorities multi-select (max 2): klusums (≤ 72 dB spin), energoefektivitāte, ātras programmas, tvaiks/alerģijas programma. These map to feed attributes and give the upgrade delta something to say.

### dryer ✅
- `g0` heat pump vs condenser ✅ — the single most important question; keep the energy sublabel.
- `g1` household ✅. `g2` stacking ✅ (soft is right: stacking kits are brand-specific).

### iron ✏️
- `g0` iron vs station ✅. `g1` volume ✅.
- `g2` auto shut-off ➖ **low value**: nearly every iron above 30 € has it, so it rarely changes the result. Replace with **"Vai ūdens tavā mājās ir ciets?"** (Jā / Nē / Nezinu) → boosts anti-scale system and removable scale collector. Hard water is common across Latvia and scale is the main reason irons die. Card reason: "Pretkaļķu sistēma — der cietam ūdenim".

### steamer ✅
Both questions are relevant. Nothing to change.

---

## Virtuves lielā tehnika

### dish ✏️
- `g0` installation ✅. ➕ Add a `semi` option ("Daļēji iebūvējama — ar redzamu vadības paneli") only if feeds distinguish it; otherwise merge into `builtin`.
- `g1` width: ✏️ **skip when `g0 = compact`** (table-top units are ~55 cm; the 45/60 question makes no sense there). showIf.
- `g2` priorities: ✏️ make multi-select (max 2) and add `energy` (energoklase) and `third` ("Trešais atvilknis galda piederumiem"). Keep `quiet`, `dry`, `fast`.

### hob ✏️
- `g0` type ✅ (wording fix, see cross-cutting 8).
- ➕ showIf `g0 = standalone`: **"Cik plata plīts?"** 50 cm / 60 cm, hard filter. Freestanding cookers come in both and the kitchen gap decides.
- ➕ showIf `g0 = gas`: **"Kāda gāze?"** Dabasgāze / Balonu gāze (propāns) / Nezinu, soft. Bottled gas is common outside Rīga; the card reason is "Komplektā sprauslas balonu gāzei". Without the right jets the hob is unusable.
- `g1` zones ✅.
- `g2` three-phase: ✏️ **showIf `g0 ∈ {induction, ceramic}`** (irrelevant for gas), keep soft, and add to the "why": "Daudzas virsmas var ierobežot jaudu vienfāzes pieslēgumam" so the user isn't scared off. Card reason for `n`: "Ir jaudas ierobežošanas režīms vienfāzes pieslēgumam".

### oven ✏️ (biggest gap in the file)
- ➕ **Missing the one question that causes returns: niche size.** Add as `g0`, hard filter: "Kāda ir niša cepeškrāsnij?" → 60 × 60 cm standarta / 45 cm augsta kompaktā / 90 cm plata / Nezinu. Everything else is secondary to whether it fits.
- `g0` steam ✅ → becomes `g1`. `g1` cleaning ✅ → `g2`.
- `g2` Wi-Fi ➖ **low value** as a standalone screen; fold it into a priorities multi-select with steam and pyrolysis, or drop. Four screens before budget is too many for an oven.

### hood ✏️
- `g0` placement ✅.
- `g1` width: ✏️ add **50 cm** and **"Nezinu"** (pass-through). 50 cm hoods exist for small kitchens; Latvian Soviet-era kitchens often have 50 cm hobs.
- `g2` outlet ✅ soft is right (most hoods support both modes with a filter).
- ➕ **"Vai virtuve ir savienota ar dzīvojamo istabu?"** → boosts low dB. Hood noise is the top complaint in reviews and the data (dB at max speed) is in most feeds.

### micro ✏️
- `g0` placement ✅. ➕ When `builtin`, note in the "why" that a frame kit may be sold separately; only ask niche width (60 vs 50 cm) if feeds carry it.
- `g1` use: ✏️ see cross-cutting 2 — `heat` must not exclude grill/combi models. Keep hard for `grill` and `combi` (must have the feature), pass-through for `heat`.
- `g2` volume ✅.

---

## Uzkopšana

### vacuum (bespoke, from spec) ✏️
- Type → area → floors → pets → priorities ✅.
- ➕ showIf `type = robot`: **"Vai robotam jāmazgā arī grīda?"** Jā / Nē. The sample data already has a `mop` attribute; this is the main price driver among robots.
- ➕ showIf `type = robot`: **"Vai mājoklis ir vairākos stāvos?"** → boosts multi-floor mapping. Optional.
- ➕ Any type: **"Vai kādam mājās ir alerģija?"** Jā / Nē → boosts HEPA filtration and sealed bag systems. Soft. Pairs naturally with the pets question (could be one screen: "Mājdzīvnieki / Alerģijas / Nekas no tā", multi-select).
- ✏️ For `corded`, the bagged vs cyclonic choice should be an option, as the spec says, plus a one-line "why" (bags cost ~5 €/year but keep dust sealed).

### steamclean ✅
Fine as is.

---

## Kafijas automāti un dzirnaviņas

### coffee ✏️
- ✏️ Reorder: `g1` machine type first (hard), then `g0` milk, then `g2` cups.
- `g0` milk ✅: card reason "Automātiski saputo pienu" is right for `auto`; for `capsule` the matching attribute is "ar piena putotāju" — make sure the tag exists on capsule products too.
- `g2` cups/day ✅.
- ➕ showIf `type = auto`: **"Vai vairāki cilvēki dzers dažādu kafiju?"** → user profiles. Optional; skip if feeds lack it.

### grinder ✏️
- ✏️ Reorder: burr/blade first, then use.
- ✏️ showIf `use = espresso`: skip the burr/blade question and **force `burr`** (blade grinders can't produce espresso grind; offering the choice sets the user up for a bad purchase). Show a one-line note instead.

---

## Virtuves mazā tehnika

### kettle ✏️
- `g0` ✏️ replace `design` with **`material`: Stikla / Nerūsējošā tērauda / Nav svarīgi** (maps to data; glass is also the "I want to see it" preference). Keep `temp` and `fast`. Consider multi-select max 2.
- `g1` volume ✅.

### blender ✅
Type and use are both relevant; `soup` correctly maps to heating blenders.

### handblender ✅
Fine.

### foodproc ✅
Stand mixer vs food processor is a real split; usage question maps to wattage and disc sets.

### mixer ✅
Fine.

### chopper ✅
Fine.

### mincer ✅
Fine. Optionally add "Vai mals arī saldētu gaļu?" → reverse function; skip for Phase 1.

### scale ✅
Fine. Two questions is right for a 15–60 € product.

### knife ✅
Fine.

---

## Grili, tosteri un friteri

### grill ✅
All three relevant. `g2` people → plate area.

### toaster ✏️
- `g0` slices ✅.
- `g1` ✏️ replace `design` with **`long`: "Garas atveres — mājās ceptai maizei"** (long-slot toasters are a real, data-backed category and the common frustration in Latvia where home-baked rye loaves are large). Keep `bun`.

### sandwich ✏️
- `g0` ✅. ➕ "Cik sviestmaizes vienlaikus?" 2 / 4, soft. One extra screen is fine for the price band.

### airfryer ✅
Excellent: type, then people → litres with concrete sublabels. Model for the others.

### breadmaker ✅
Fine.

### minioven ✅
Fine.

---

## Veselīgam uzturam

### juicer ✏️
- `g0` type ✅ with a good "why".
- ➕ **"Ko spiedīsi visbiežāk?"** Cietus augļus un dārzeņus (āboli, burkāni) / Lapu zaļumus un ogas / Visu. Slow juicers win on greens, centrifugal on hard fruit; this makes the recommendation explainable. Soft.

### dehydrator ✅
Fine.

### vacuumsealer ✅
Fine.

---

## Summary of proposed edits

| Subcategory | Change | Type |
|---|---|---|
| all | `any` pass-through rule, "contradict not exceed" rule, unknown-attribute rule | engine (⚠️, item 3 is an **owner decision**) |
| all | optional "Cita summa" budget input | **owner decision** |
| freezer | garage → hard filter; niche height if built-in | edit |
| washer | skip space question for top-loaders; add priorities | edit |
| iron | replace auto shut-off with hard-water question | edit |
| dish | skip width for compact; priorities multi-select + energy + third tray | edit |
| hob | width for standalone; gas type for gas; three-phase only for electric | edit |
| oven | add niche size as first hard question; fold Wi-Fi into priorities | edit |
| hood | 50 cm + Nezinu; open-plan kitchen question | edit |
| micro | heat-only must not exclude grill/combi | engine |
| vacuum | mopping and allergies; multi-floor optional | edit |
| coffee, grinder | reorder type first; force burr for espresso | edit |
| kettle, toaster | replace "Dizains" with material / long slot | edit |
| sandwich, juicer | one added soft question each | edit |

Total screens per flow after changes stay within 2–4 category questions + budget + refurbished + urgency; the oven gains one screen but loses one, and the washer and dishwasher gain one multi-select.
