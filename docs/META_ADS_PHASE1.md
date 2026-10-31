# Meta Phase 1 — ready-to-upload ads (31 Oct 2026)

Campaign: **Traffic → Website → Maximise number of landing page views**, dataset **Trilio Web** (`2161476984461393`), Latvia, Advantage+ audience and placements, 15–20 €/day on the campaign (docs/META_ADS_PLAN.md §3, §6).

Files: `assets/ads/meta-phase1/` (regenerate with `npm run creatives:meta`, source `scripts/meta-phase1.gen.ts`).

## How the set is built (owner's review, 1 Nov 2026)

The first set (drawings, category icons) was rejected as template-like, and "secību nenosaka komisija" as misleading: there is no commission. This set is **product-led and designed**, not screenshots: the site's own elements (the first question, the recommendation card, the two buttons) are drawn at poster scale with **real data** from trilio.lv/rezultati?sub=washer on 1 Nov 2026 (three picks for 3–4 people, front loading, 300–700 €: Gorenje W11NHPI84AS 324 €, LG F4X1009NWB 360 €, LG F4X5011TWB 432 €, all at Tet) and the shops' product photos. Every picture with a price carries the date. Source: `scripts/meta-phase1.gen.tsx`, data in `assets/ads/meta-phase1-src/`.

- **Five distinct ideas:** the three recommendations (A1), the request (A2), the question (A3), fit to criteria (A4), the four-swipe story (A5), and one Reel through all of it (R1). Meta's ad retrieval treats near-identical ads as one, so each ad has its own angle, not a colour variant.
- **Every placement has its own shape** in one ad: **4:5** Feeds, **9:16** Stories/Reels (content inside Meta's interface margins: top 280 px, bottom 480 px), **1:1** right column, Search, Marketplace.
- **One hero per ad**, the lime "Pieprasīt labāku cenu" button is the hero of the request ad; no decoration beyond the brand glow.
- **Text:** the point in the headline, no pronoun of address, at most one emoji in primary text, no "lētākais" claims (the label "Lētākais, ko paši pirktu" is the site's own tier name on the card, not an ad claim). Every line below passed `lintPost`.

## Settings that are the same for every ad

| Field | Value |
|---|---|
| Identity | Facebook page **Trilio**, Instagram account **trilio.lv** |
| Format | Single image or video (A5: Carousel) |
| Call to action | **Uzzināt vairāk** |
| URL parameters | `utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}` |
| Website events | Dataset **Trilio Web** |
| Advantage+ creative | **Off**: text improvements, overlays, music, image expansion/generation, relevant comments |
| Multiple text options | **On** (all primary texts and headlines) |

Name every ad exactly as below: the name travels in `utm_content`, so Admin → Statistika shows which ad brought each request.

## A1 · Trīs ieteikumi

- **Files:** `A1-tris-ieteikumi/…_4x5`, `…_9x16`, `…_1x1`
- **URL:** `https://trilio.lv/izvelies/laundry/washer`
- **Primary text:**
  1. Priekšējā ielāde, 3–4 cilvēki, noteikts budžets. Pēc dažiem jautājumiem Trilio parāda trīs piemērotākās veļas mašīnas no Latvijas veikaliem.
  2. Veļas mašīnas izvēle bez desmit atvērtām cilnēm: daži jautājumi, trīs ieteikumi, un pie katra poga „Pieprasīt labāku cenu”.
  3. 🔎 Daži jautājumi, trīs ieteikumi. Pie katra rakstīts, kāpēc tieši šis.
- **Headline:** Daži jautājumi. 3 ieteikumi. · Veļas mašīna dažos jautājumos · Trīs piemērotākās veļas mašīnas
- **Description:** Padoms bez maksas

## A2 · Pieprasi labāku cenu

- **Files:** `A2-pieprasi-labaku-cenu/…`
- **URL:** `https://trilio.lv/izvelies/laundry/washer`
- **Primary text:**
  1. Cenu var pajautāt. Pie katra Trilio ieteikuma ir poga „Pieprasīt labāku cenu”: pajautāsim izplatītājam, un, ja varēsim piedāvāt lētāk, atsūtīsim piedāvājumu.
  2. Piemērots modelis atrasts? Var pirkt uzreiz veikalā vai pieprasīt labāku cenu. Ja lētāk nesanāks, paziņosim, kad cena veikalos kritīs.
  3. 🏷️ Pieprasījums bez maksas. Ja varēsim piedāvāt lētāk nekā veikalā, piedāvājums atnāks uz e-pastu; ja ne, ziņa par cenas kritumu.
- **Headline:** Pieprasi labāku cenu · Cenu var pajautāt · Tā pati prece, iespējams lētāk
- **Description:** Pieprasījums bez maksas

## A3 · Daži jautājumi

- **Files:** `A3-dazi-jautajumi/…`
- **URL:** `https://trilio.lv/izvelies/laundry/washer`
- **Primary text:**
  1. Kuru veļas mašīnu izvēlēties? Daži jautājumi par to, kas svarīgs, un trīs piemērotākie varianti no Latvijas veikaliem. Padoms bez maksas, bez konta.
  2. Sadzīves tehnikas izvēle dažos jautājumos. Trilio salīdzina Latvijas partneru veikalu piedāvājumu un parāda trīs piemērotākos variantus.
  3. Jauna veļas mašīna? Atbildes uz dažiem jautājumiem, un trīs varianti ar šodienas cenām partneru veikalos.
- **Headline:** Izvēle dažos jautājumos · Sadzīves tehnika bez minēšanas · Daži jautājumi. 3 ieteikumi.
- **Description:** Padoms bez maksas

## A4 · Piemērotākais modelis

- **Files:** `A4-piemerotakais-modelis/…`
- **URL:** `https://trilio.lv/izvelies/laundry/washer`
- **Primary text:**
  1. Piemērotākais modelis atbilstoši kritērijiem: cik cilvēku, kāda ielāde, cik budžets. Pie katra ieteikuma rakstīts, kāpēc tieši šis.
  2. Nav jāsalīdzina modelis pa modelim. Daži jautājumi, un trīs varianti, kas atbilst atbildēm.
  3. Ledusskapju, veļas mašīnu un putekļsūcēju ir daudz, piemēroti ir daži. Trilio parāda, kuri.
- **Headline:** Ieteikumi pēc atbildēm · Piemērotākais modelis · Daudz modeļu. Trīs, kas der.
- **Description:** Padoms bez maksas

## A5 · Karuselis: četri soļi

- **Format:** Carousel, 4 cards, **1:1** (`A5-karuselis/`). "Show the best-performing cards first": **off**. "Add a card at the end with your Page profile picture": **off**.
- **Primary text:**
  1. Kā tas notiek: daži jautājumi, trīs piemērotākie modeļi, pie katra kāpēc, un poga „Pieprasīt labāku cenu”. Četri soļi bildēs.
  2. Veļas mašīna trīs soļos: daži jautājumi, trīs ieteikumi, un pēc tam pērc uzreiz vai pieprasi labāku cenu.
- **Cards** (headline · description · URL, all to `https://trilio.lv/izvelies/laundry/washer`):
  1. Daži jautājumi · Tikai tie, kas izšķir izvēli
  2. Trīs piemērotākie modeļi · Cenas partneru veikalos
  3. Pie katra: kāpēc tieši šis · Ieteikumi pēc atbildēm
  4. Pieprasi labāku cenu · Pieprasījums bez maksas

## R1 · Reel: kā tas strādā (15,6 s)

- **Files:** `R1-ka-tas-strada/…_9x16.mp4` (Stories, Reels), `…_4x5.mp4` (Feeds); covers `…_cover.jpg`
- **URL:** `https://trilio.lv/izvelies/laundry/washer`
- **Primary text:**
  1. Veļas mašīna trīs soļos: daži jautājumi, trīs ieteikumi, un pēc tam pērc uzreiz vai pieprasi labāku cenu.
  2. Cenu var pajautāt. Trilio pajautā izplatītājam: ja varēsim lētāk, atsūtīsim piedāvājumu; ja ne, paziņosim, kad cena kritīs.
- **Headline:** Daži jautājumi. 3 ieteikumi. · Pieprasi labāku cenu
- **Sound:** the file is silent. In the ad, **Add music → choose one calm track yourself** (not "Automatic music").

## Optional 7th ad

Your best organic link post of the week as an ad ("Use existing post"): it keeps its likes and comments.

## After publishing

Day 1: check every ad is "Active" (not "In review" or "Rejected") and open each landing link once. Days 1–7: no edits. Day 7: pause any ad that spent about twice the others' cost per landing page view with no better-price request; tell me the numbers and I'll make 2–3 new concepts.

## Sources

[Meta safe zones 2026 (Billo)](https://billo.app/blog/meta-ads-safe-zones) · [Meta ads creative specs 2026 (Benly)](https://benly.ai/learn/ad-creative/meta-ads-creative-specs-2026) · [Meta ad sizes 2026 (Superscale)](https://superscale.ai/learn/meta-ad-sizes) · [Meta Andromeda creative guide (Chatterbuzz)](https://www.chatterbuzzmedia.com/blog/meta-andromeda-creative-targeting/) · [Meta 2026 algorithm update (Jetfuel)](https://jetfuel.agency/metas-2026-algorithm-update-what-andromeda-changed-and-how-to-adapt-your-ads/) — vendor summaries, numbers indicative.
