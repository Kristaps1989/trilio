# Meta Phase 1 — ready-to-upload ads (31 Oct 2026)

Campaign: **Traffic → Website → Maximise number of landing page views**, dataset **Trilio Web** (`2161476984461393`), Latvia, Advantage+ audience and placements, 15–20 €/day on the campaign (docs/META_ADS_PLAN.md §3, §6).

Files: `assets/ads/meta-phase1/` (regenerate with `npm run creatives:meta`, source `scripts/meta-phase1.gen.ts`).

## How the set is built (owner's review, 1 Nov 2026)

The first set (drawings, category icons) was rejected as template-like, and "secību nenosaka komisija" as misleading: there is no commission. This set is **product-led and designed**, not screenshots: the site's own elements (the first question, the recommendation card, the two buttons) are drawn at poster scale with **real data** from trilio.lv/rezultati?sub=washer on 1 Nov 2026 (three picks for 3–4 people, front loading, 300–700 €: Gorenje W11NHPI84AS 324 €, LG F4X1009NWB 360 €, LG F4X5011TWB 432 €, all at Tet) and the shops' product photos. Every picture with a price carries the date. Source: `scripts/meta-phase1.gen.tsx`, data in `assets/ads/meta-phase1-src/`.

- **Five distinct ideas:** the three recommendations (A1), the request (A2), the question (A3), fit to criteria (A4), the four-swipe story (A5), and one Reel through all of it (R1). Meta's ad retrieval treats near-identical ads as one, so each ad has its own angle, not a colour variant.
- **Every placement has its own shape** in one ad: **4:5** Feeds, **9:16** Stories/Reels (content inside Meta's interface margins: top 280 px, bottom 480 px), **1:1** right column, Search, Marketplace, **1.91:1** (1200×628, the text left and the site element right) Audience Network, Messenger, in-stream and the desktop right column. In the Crop step choose **Replace** under Square, Vertical and Horizontal and upload the `_1x1`, `_9x16` and `_1.91x1` files; the 4:5 is the main file. Never let Meta crop the 4:5 for Horizontal: it cuts the headline.
- **One hero per ad**, the lime "Pajautāt cenu" button is the hero of the request ad; no decoration beyond the brand glow.
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

- **Files:** `A1-tris-ieteikumi/…_4x5`, `…_9x16`, `…_1x1`, `…_1.91x1`
- **URL:** `https://trilio.lv/izvelies/laundry/washer`
- **Primary text:**
  1. Priekšējā ielāde, 3–4 cilvēki, noteikts budžets. Pēc dažiem jautājumiem Trilio parāda trīs piemērotākās veļas mašīnas no Latvijas veikaliem.
  2. Veļas mašīnas izvēle bez desmit atvērtām cilnēm: daži jautājumi, trīs ieteikumi, un pie katra poga „Pajautāt cenu”.
  3. 🔎 Daži jautājumi, trīs ieteikumi. Pie katra rakstīts, kāpēc tieši šis.
- **Headline:** Daži jautājumi. 3 ieteikumi. · Veļas mašīna dažos jautājumos · Trīs piemērotākās veļas mašīnas
- **Description:** Padoms bez maksas

## A2 · Pajautā zemāku cenu

- **Files:** `A2-pieprasi-labaku-cenu/…`
- **URL:** `https://trilio.lv/izvelies/laundry/washer`
- **Primary text:**
  1. Cenu var pajautāt. Pie katra Trilio ieteikuma ir poga „Pajautāt cenu”: pajautāsim izplatītājam, un, ja varēsim piedāvāt lētāk, atsūtīsim piedāvājumu.
  2. Piemērots modelis atrasts? Var pirkt uzreiz veikalā vai pajautāt zemāku cenu. Ja lētāk nesanāks, paziņosim, kad cena veikalos samazināsies.
  3. 🏷️ Pieprasījums bez maksas. Ja varēsim piedāvāt lētāk nekā veikalā, piedāvājums atnāks uz e-pastu; ja ne, ziņa par cenas kritumu.
- **Headline:** Pajautā zemāku cenu · Cenu var pajautāt · Tā pati prece, iespējams lētāk
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
  1. Kā tas notiek: daži jautājumi, trīs piemērotākie modeļi, pie katra kāpēc, un poga „Pajautāt cenu”. Četri soļi bildēs.
  2. Veļas mašīna trīs soļos: daži jautājumi, trīs ieteikumi, un pēc tam pērc uzreiz vai pajautā zemāku cenu.
- **Cards** (headline · description · URL, all to `https://trilio.lv/izvelies/laundry/washer`):
  1. Daži jautājumi · Tikai tie, kas izšķir izvēli
  2. Trīs piemērotākie modeļi · Cenas partneru veikalos
  3. Pie katra: kāpēc tieši šis · Ieteikumi pēc atbildēm
  4. Pajautā zemāku cenu · Pieprasījums bez maksas

## R1 · Reel: kā tas strādā (14 s, motion)

- **Files:** `R1-ka-tas-strada/…_9x16.mp4` (Stories, Reels), `…_4x5.mp4` (Feeds), `…_16x9.mp4` (in-stream, desktop video feeds; the text left and the site element right); covers `…_cover.jpg`. In the Crop step: Vertical → Replace with `_9x16`, Square → keep Original (the 1:1 crop of the 4:5 cuts the footnote of the request scene), Horizontal → Replace with `_16x9`. Made by `npm run creatives:reel` (`scripts/meta-reel.gen.tsx`): every frame is laid out from the time, 30 fps, so entrances ease in, the option gets tapped, the three cards slide in one by one, the lime button is pressed and turns into the site's "Pajautāts · meklējam zemāku cenu".
- **Scenes:** the pile of product cards ("353 veļas mašīnas 3 veikalos. Kuru izvēlēties?", the site's real count) → the first question, answered ("Daži jautājumi. Tikai tie, kas izšķir.") → the three fitting models with the criteria ("Trīs, kas der. Ar cenām no veikaliem.") → the request ("Patīk? Pajautā zemāku cenu.") → logo, trilio.lv, "Sākt izvēli".
- **URL:** `https://trilio.lv/izvelies/laundry/washer`
- **Primary text:**
  1. Veļas mašīna trīs soļos: daži jautājumi, trīs ieteikumi, un pēc tam pērc uzreiz vai pajautā zemāku cenu.
  2. Cenu var pajautāt. Trilio pajautā izplatītājam: ja varēsim lētāk, atsūtīsim piedāvājumu; ja ne, paziņosim, kad cena samazināsies.
- **Headline:** Daži jautājumi. 3 ieteikumi. · Pajautā zemāku cenu
- **Sound:** the file is silent. In the ad, **Add music → choose one calm track yourself** (not "Automatic music").

## R2 · Reel: kā pajautāt cenu (22 s, motion, with sound)

Owner's ask (3 Nov 2026): a dedicated video for the request, showing how a shopper gets a lower price by leaving an e-mail, with sound.

- **Files:** `R2-pajauta-cenu/…_9x16.mp4` (Stories, Reels), `…_4x5.mp4` (Feeds), `…_16x9.mp4` (in-stream, desktop video feeds); covers `…_cover.jpg` (the sheet with "līdz −10 %"). Crop step as for R1. Made by `npm run creatives:reel2` (`scripts/meta-reel2.gen.tsx`; one shape per run with `REEL_SHAPES=story`, `feed` or `wide`).
- **Scenes (the site's own copy on every screen):** the card and a tap on "Pirkt — Tet" ("Atradi īsto? Spied „Pirkt”.") → the question before the shop slides up: "Pirms pērc — pajautāsim zemāku cenu", the lime strip "līdz −10 % · šai precei tas ir līdz 32,40 € lētāk" and the three steps ("Cena var būt līdz 10 % zemāka.") → "Turpināt ar Google" or the e-mail, typed, then a tap on "Pajautāt cenu" ("Atstāj e-pastu. Vai turpini ar Google.") → "Pajautāts. Meklējam zemāku cenu un uzrakstīsim." ("Mēs sazināmies ar izplatītāju.") → an e-mail notification with the subject the offer e-mail really uses, "Gorenje W11NHPI84AS par 299 €. Lētāk nekā veikalos.", and the two prices, footnoted **"Ilustratīvs piemērs. Ne katrai precei izdodas; ja ne, paziņosim, kad cena samazināsies."** ("Ja atradīsim lētāk, atsūtīsim piedāvājumu.") → the brand (owner, 3 Nov 2026: end on Trilio and its values): the mark, the tagline in its three beats ("Daži jautājumi." · "3 ieteikumi." · "Pērc uzreiz vai pajautā zemāku cenu." in lime), three values with a tick ("Secību nenosaka komisija", "Cenas no veikaliem Latvijā", "Padoms bez maksas") and trilio.lv
- **Sound (in the file, ours to use):** synthesised in `scripts/reel-audio.ts`, no licence needed. A light C–G–Am–F bed at 100 BPM that builds with the story (pad, then bass, pluck and kick when the sheet opens, hats at the e-mail, claps at "Pajautāts", resolving on the logo), plus interface sounds on the picture's own events: the taps, a whoosh as the sheet opens, a pop on the discount, a key tick per typed letter, a two-note "done" and a three-note chime when the e-mail arrives. Loudness normalised to about −14 LUFS. In Ads Manager keep the video's own sound: **do not add music**. Everything is also readable with the sound off.
- **Honesty:** the example offer (299 € against 324 €, 25 € less) stays inside "līdz 10 %" and is labelled as an example; the 10 % must stay a discount offers really reach (docs/PRICE_NOTIFY_PLAN.md §8.7).
- **URL:** `https://trilio.lv/izvelies/laundry/washer`
- **Primary text:**
  1. Pirms pirkuma cenu var pajautāt Trilio. Sazināmies ar izplatītāju, un, ja izdodas atrast lētāk (līdz 10 %), piedāvājums atnāk e-pastā. Bez maksas, pirkt nav obligāti.
  2. Jāatstāj tikai e-pasts: Trilio pajautā izplatītājam cenu tieši šai precei. Ja lētāk nesanāk, paziņojam, kad cena veikalos samazinās.
- **Headline:** Cena var būt līdz 10 % zemāka · Pajautā zemāku cenu
- **Optimisation:** this is the request ad, so in Phase 2 it is the one to optimise for the `Lead` event (docs/META_ADS_PLAN.md).

## Optional 7th ad

Your best organic link post of the week as an ad ("Use existing post"): it keeps its likes and comments.

## After publishing

Day 1: check every ad is "Active" (not "In review" or "Rejected") and open each landing link once. Days 1–7: no edits. Day 7: pause any ad that spent about twice the others' cost per landing page view with no better-price request; tell me the numbers and I'll make 2–3 new concepts.

## Sources

[Meta safe zones 2026 (Billo)](https://billo.app/blog/meta-ads-safe-zones) · [Meta ads creative specs 2026 (Benly)](https://benly.ai/learn/ad-creative/meta-ads-creative-specs-2026) · [Meta ad sizes 2026 (Superscale)](https://superscale.ai/learn/meta-ad-sizes) · [Meta Andromeda creative guide (Chatterbuzz)](https://www.chatterbuzzmedia.com/blog/meta-andromeda-creative-targeting/) · [Meta 2026 algorithm update (Jetfuel)](https://jetfuel.agency/metas-2026-algorithm-update-what-andromeda-changed-and-how-to-adapt-your-ads/) — vendor summaries, numbers indicative.
