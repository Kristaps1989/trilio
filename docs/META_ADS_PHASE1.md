# Meta Phase 1 — ready-to-upload ads (31 Oct 2026)

Campaign: **Traffic → Website → Maximise number of landing page views**, dataset **Trilio Web** (`2161476984461393`), Latvia, Advantage+ audience and placements, 15–20 €/day on the campaign (docs/META_ADS_PLAN.md §3, §6).

Files: `assets/ads/meta-phase1/` (regenerate with `npm run creatives:meta`, source `scripts/meta-phase1.gen.ts`).

## How the set is built (2026 practice, applied)

- **8 distinct ideas, not 8 colours.** Meta's ad retrieval (Andromeda) groups near-identical ads as one; each ad here has its own angle: what Trilio is (A1), the price request (A2, R2), choice overload (A3), a concrete flow (A4, R1), trust (A5), and categories (A6).
- **Every placement has its own shape** in one ad ("placement asset customisation"): **4:5** for Feeds, **9:16** for Stories and Reels, **1:1** for the right column, Search and Marketplace. The 9:16 versions keep text out of the top 14 % and bottom ~25 % (Meta's interface) and inside 6 % side margins.
- **Two Reels** (14–16 s, 9:16 and 4:5): the point in the first 2 seconds, text on screen throughout (most watch muted), one idea per frame, the brand in frame 1. Video in 9:16 is the format Meta's own guidance pushes most; statics stay for Feed variety.
- **Text:** the point first (the first ~125 characters show before "… vairāk"), plain Latvian, no pronoun of address in ad text (BRAND.md), at most one emoji, no hype, prices or "lētākais". Three primary texts and three headlines per ad: Meta shows each person the combination that works for them ("Multiple text options"). Every line passed the site's honesty lint.
- **No prices or product names in the images:** prices change daily and an ad must never show a price a shop no longer has. The phone shows the site's real questions and buttons; the product on the card is a drawing.

## Settings that are the same for every ad

| Field | Value |
|---|---|
| Identity | Facebook page **Trilio**, Instagram account **Trilio** |
| Format | Single image or video (A6: Carousel) |
| Call to action | **Uzzināt vairāk** (Learn more) |
| Destination | Website; URL per ad below |
| URL parameters (Tracking → Build a URL parameter) | `utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}` |
| Website events | Dataset **Trilio Web** on |
| Advantage+ creative | **Off** for: text improvements, add overlays, music, image expansion/generation, "relevant comments", catalogue items. **On** (allowed): image brightness/contrast, 9:16 adapt only if a shape is missing (none are) |
| Multiple text options | **On** (paste all three primary texts and headlines) |

Name every ad exactly as below (`A1 Daži jautājumi` …): the name travels in `utm_content`, so Admin → Statistika shows which ad brought each request.

## A1 · Daži jautājumi (what Trilio is)

- **Files:** `A1-dazi-jautajumi/…_4x5`, `…_9x16`, `…_1x1`
- **URL:** `https://trilio.lv/`
- **Primary text:**
  1. Sadzīves tehnikas izvēle dažos jautājumos. Trilio salīdzina Latvijas partneru veikalu piedāvājumu un parāda trīs piemērotākos variantus. Pērc uzreiz vai pieprasi labāku cenu.
  2. Ledusskapis, veļas mašīna vai putekļsūcējs? Daži jautājumi par to, kas svarīgs, un trīs piemērotākie varianti no Latvijas veikaliem. Padoms bez maksas, bez konta.
  3. 🔎 Mazāk cilņu, mazāk minēšanas. Daži jautājumi, trīs ieteikumi, un pie katra poga „Pieprasīt labāku cenu”.
- **Headline:** Daži jautājumi. 3 ieteikumi. · Sadzīves tehnika bez minēšanas · Izvēle dažos jautājumos
- **Description:** Padoms bez maksas

## A2 · Cenu var pajautāt (the price request)

- **Files:** `A2-cenu-var-pajautat/…`
- **URL:** `https://trilio.lv/izvelies`
- **Primary text:**
  1. Cenu var pajautāt. Pie katra Trilio ieteikuma ir poga „Pieprasīt labāku cenu”: pajautāsim izplatītājam, un, ja varēsim piedāvāt lētāk, atsūtīsim piedāvājumu.
  2. Piemērots modelis atrasts? Var pirkt uzreiz veikalā vai pieprasīt labāku cenu. Ja lētāk nesanāks, paziņosim, kad cena veikalos kritīs.
  3. 🏷️ Pieprasījums bez maksas. Ja varēsim piedāvāt lētāk nekā veikalā, piedāvājums atnāks uz e-pastu; ja ne, ziņa par cenas kritumu.
- **Headline:** Pieprasi labāku cenu · Cenu var pajautāt · Tā pati prece, iespējams lētāk
- **Description:** Pieprasījums bez maksas

## A3 · Daudz modeļu. Trīs, kas der. (choice overload, fridges)

- **Files:** `A3-tris-kas-der/…`
- **URL:** `https://trilio.lv/izvelies/cool/fridge`
- **Primary text:**
  1. Ledusskapju ir daudz, piemēroti ir daži. Brīvi stāvošs vai iebūvējams, cik durvju, cik cilvēku, un Trilio parāda trīs piemērotākos no Latvijas veikaliem.
  2. Nav jāsalīdzina modelis pa modelim. Daži jautājumi, trīs ieteikumi, un secību nenosaka veikalu komisija.
  3. Jauns ledusskapis? Sākumā daži jautājumi, beigās trīs varianti, ko var pirkt uzreiz vai pieprasīt labāku cenu.
- **Headline:** Ledusskapis dažos jautājumos · Daudz modeļu. Trīs, kas der. · Trīs piemērotākie ledusskapji
- **Description:** Padoms bez maksas

## A4 · Veļas mašīna dažos jautājumos (a concrete flow)

- **Files:** `A4-vela-dazos-jautajumos/…`
- **URL:** `https://trilio.lv/izvelies/laundry/washer`
- **Primary text:**
  1. Priekšējā vai augšējā ielāde? Cik cilvēku mājās? Pēc dažiem jautājumiem Trilio parāda trīs piemērotākās veļas mašīnas no Latvijas veikaliem.
  2. Veļas mašīnas izvēle bez desmit atvērtām cilnēm: daži jautājumi, trīs ieteikumi, un pie katra poga „Pieprasīt labāku cenu”.
  3. Jauna veļas mašīna? Atbildes uz dažiem jautājumiem, un trīs varianti ar šodienas cenām partneru veikalos.
- **Headline:** Veļas mašīna dažos jautājumos · Trīs piemērotākās veļas mašīnas · Pērc uzreiz vai pieprasi labāku cenu
- **Description:** Padoms bez maksas

## A5 · Secību nenosaka komisija (trust)

- **Files:** `A5-seciba-bez-komisijas/…`
- **URL:** `https://trilio.lv/`
- **Primary text:**
  1. Ieteikumu secību nosaka tas, kas atbilst atbildēm, nevis veikala komisija. Kā tieši, rakstīts pie katra ieteikuma: „Kā mēs izvēlamies un prioritizējam?”
  2. Jauns serviss ar vienkāršu principu: daži jautājumi, trīs piemērotākie varianti, un secību nenosaka komisija. Padoms bez maksas.
  3. Trilio nesaņem samaksu par vietu sarakstā. Daži jautājumi, un trīs varianti, kas atbilst atbildēm.
- **Headline:** Secību nenosaka komisija · Ieteikumi pēc atbildēm · Kā mēs izvēlamies
- **Description:** Padoms bez maksas

## A6 · Karuselis: četras kategorijas + pieprasījums

- **Format:** Carousel, 5 cards, all **1:1** (`A6-karuselis/`). "Show the best-performing cards first": **off** (the request card stays last). "Add a card at the end with your Page profile picture": **off**.
- **Primary text:**
  1. Četras kategorijas, viens princips: daži jautājumi un trīs piemērotākie varianti no Latvijas veikaliem. Pie katra var pieprasīt labāku cenu.
  2. Ledusskapji, veļas mašīnas, trauku mazgājamās mašīnas, putekļsūcēji. Katrai kategorijai daži jautājumi un trīs ieteikumi no Latvijas veikaliem.
- **Cards** (headline · description · URL):
  1. Ledusskapji · Daži jautājumi, 3 ieteikumi · `https://trilio.lv/izvelies/cool/fridge`
  2. Veļas mašīnas · Daži jautājumi, 3 ieteikumi · `https://trilio.lv/izvelies/laundry/washer`
  3. Trauku mazgājamās mašīnas · Daži jautājumi, 3 ieteikumi · `https://trilio.lv/izvelies/kitchenbig/dish`
  4. Putekļsūcēji · Daži jautājumi, 3 ieteikumi · `https://trilio.lv/izvelies/clean/vacuum`
  5. Pieprasi labāku cenu · Pieprasījums bez maksas · `https://trilio.lv/izvelies`

## R1 · Reel: veļas mašīna 3 soļos (15,8 s)

- **Files:** `R1-vela-3-soli/…_9x16.mp4` (Stories, Reels), `…_4x5.mp4` (Feeds); cover images `…_cover.jpg`
- **URL:** `https://trilio.lv/izvelies/laundry/washer`
- **Primary text:**
  1. Veļas mašīna trīs soļos: daži jautājumi, trīs ieteikumi, un pēc tam pērc uzreiz vai pieprasi labāku cenu.
  2. Priekšējā vai augšējā ielāde? Cik cilvēku mājās? Pēc dažiem jautājumiem Trilio parāda trīs piemērotākās veļas mašīnas no Latvijas veikaliem.
- **Headline:** Veļas mašīna dažos jautājumos · Pērc uzreiz vai pieprasi labāku cenu
- **Sound:** the files are silent. In the ad, **Add music → choose one calm track yourself** from Meta's library (not "Automatic music"). Reels with sound usually do better.

## R2 · Reel: cenu var pajautāt (14,2 s)

- **Files:** `R2-cenu-var-pajautat/…`
- **URL:** `https://trilio.lv/izvelies`
- **Primary text:**
  1. Cenu var pajautāt. Trilio pajautā izplatītājam: ja varēsim lētāk, atsūtīsim piedāvājumu; ja ne, paziņosim, kad cena kritīs.
  2. 🏷️ Pieprasījums bez maksas. Ja varēsim piedāvāt lētāk nekā veikalā, piedāvājums atnāks uz e-pastu; ja ne, ziņa par cenas kritumu.
- **Headline:** Pieprasi labāku cenu · Cenu var pajautāt
- **Sound:** as R1.

## Optional 9th ad

Your best organic link post of the week as an ad ("Use existing post"): it keeps its likes and comments. Same URL parameters cannot be added to an existing post; its own UTM tags (utm_source=facebook) still show it in Admin.

## After publishing

Day 1: check every ad is "Active" (not "In review" or "Rejected") and open each landing link once. Days 1–7: no edits. Day 7: pause any ad that spent about twice the others' cost per landing page view with no better-price request; tell me the numbers and I'll make 2–3 new concepts.

## Sources

[Meta safe zones 2026 (Billo)](https://billo.app/blog/meta-ads-safe-zones) · [Meta ads creative specs 2026 (Benly)](https://benly.ai/learn/ad-creative/meta-ads-creative-specs-2026) · [Meta ad sizes 2026 (Superscale)](https://superscale.ai/learn/meta-ad-sizes) · [Meta Andromeda creative guide (Chatterbuzz)](https://www.chatterbuzzmedia.com/blog/meta-andromeda-creative-targeting/) · [Meta 2026 algorithm update (Jetfuel)](https://jetfuel.agency/metas-2026-algorithm-update-what-andromeda-changed-and-how-to-adapt-your-ads/) — vendor summaries, numbers indicative.
