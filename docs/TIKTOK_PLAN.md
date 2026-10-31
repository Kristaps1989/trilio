# TikTok ads test: strategy and creatives (31 Oct 2026)

Owner's ask: test ads on TikTok. The brand is new and unknown; the business interest is Trilio's own special offers, which start with a shopper tapping "Pieprasīt labāku cenu" on a product.

## 1. What TikTok is good for here, and what it is not

Google Search catches people who already type "trauku mazgājamā mašīna". TikTok reaches people who are not shopping today, so it cannot sell a dishwasher; it can plant one idea: **you can ask Trilio for a better price than the shops, and it is free**. An unknown brand on TikTok wins only when the ad is about the mechanism and the viewer's gain, never about the brand. The brand is learned as a by-product.

So the test is not "does TikTok sell appliances"; it is "does a 15-second explanation of the request make people come and tap `Pieprasīt labāku cenu`, and at what cost". That tap is the event every creative is judged on.

## 2. The offer in one sentence (the ad's job)

> Atradi preci, nospied „Pieprasīt labāku cenu”, un Trilio pajautās izplatītājam. Ja būs lētāk, atsūtīsim piedāvājumu; ja ne, uzrakstīsim, kad cena veikalos samazināsies. Bez maksas.

Everything in the ads is a variation of this; nothing promises a price, a percentage or a deadline (CLAUDE.md rule 4, `src/domain/ads/honesty.ts`).

## 3. Set-up (week 1, before any spend)

1. **TikTok Ads Manager** with a Business Center, the Trilio TikTok account (needed for Spark Ads), and the LV legal entity. Pay by card.
2. **Pixel + Events API** on the site, loaded only after consent, like GA4 today (`src/ui/analytics`). Events to send: `ViewContent` on results, **`SubmitForm`** on the notify tap (the key event), `CompleteRegistration` on the confirmed e-mail, `Purchase` on a paid order. Store `ttclid` from the landing URL the way `gclid` is stored (`ad_landings`), so a request can be attributed without cookies. This is one small PR; say the word and I build it.
3. **UTM convention:** `utm_source=tiktok&utm_medium=paid&utm_campaign=request-test&utm_content={creative-id}`; the existing UTM landing capture already records it.
4. **Landing pages.** Not the home page. Each ad lands on the category it showed, on the short flow (`/izvelies/{group}/{sub}`), so the viewer is three taps from a result card with the button. Start with two categories with real margin and strong partner stock: dishwashers (`dish`) and fridges (`fridge`); add robot vacuums (`vacuum`) if the first two work.
5. **Account warm-up:** post the same videos organically on the Trilio account first (3–5 posts). It costs nothing, it tells which hooks hold attention, and the best ones become Spark Ads with their real comments and likes attached.

## 4. Campaign structure for the test

| Setting | Choice | Why |
| --- | --- | --- |
| Objective | Website conversions, optimised to `SubmitForm` (the notify tap) | Purchases are too rare to learn from; the tap is frequent and is the business event. |
| Fallback | If fewer than ~50 taps in week 1, switch optimisation to Landing page view for a week, then back | TikTok needs ~50 events per ad group a week to leave learning. |
| Campaigns | One campaign, campaign budget optimisation on | One budget, TikTok allocates. |
| Ad groups | A: Automatic targeting, LV, 25–54. B: Interest "Home & Garden / Home appliances" + behaviours "engaged with shopping content", LV, 25–54 | Broad usually wins on TikTok; B is the control. |
| Placement | TikTok only, no Pangle, no comments off | Pangle brings cheap, worthless clicks. |
| Budget | 20 €/day for 14 days (≈ 280 €), then decide | Enough for ~25–35 k impressions at LV CPMs and a readable cost per tap. |
| Ads | 5 creatives per ad group, same five in both | The creative is the variable; the targeting is the control. |
| Bidding | Lowest cost (no bid cap) during the test | Caps starve learning. |
| Schedule | All day; TikTok's LV peak is 19–23 | Let the algorithm find it. |
| Format | 9:16, 1080×1920, 15–25 s, sound on, burned-in captions | Native format or nothing. |

Spark Ads (boosting the organic post) over ordinary in-feed ads whenever the post exists: better CTR, comments stay, and the profile link is live.

## 5. Creative principles (best practice, applied)

1. **Hook in the first second**, spoken and on screen, and it is a claim about the viewer's money, not about Trilio.
2. **One idea per video.** The idea is the request. Not the ranking, not the three tiers, not the energy cost.
3. **Show the tap.** Every video includes 3–4 seconds of real screen recording: the result card, the thumb on "Pieprasīt labāku cenu", the panel, the note "Meklējam labāku cenu…". People believe what they see done.
4. **Talk like a person, not a brand.** Phone footage, one speaker, no logo intro, no music bed louder than the voice. The logo appears at the end for one second.
5. **Say the catch.** "Ja nebūs lētāk, pateiksim, kad cena kritīs." Honesty is the differentiator for an unknown brand; the ad that admits the limit is the one that gets trusted.
6. **CTA is the button's own words:** "Pieprasīt labāku cenu", never "Uzzini vairāk".
7. **Captions and voice in Latvian**, informal "tu", infinitive buttons, as on the site.

## 6. The five creatives

Each: hook (0–2 s), body, screen part, close. Spoken lines in Latvian; on-screen text in **bold**. Durations are targets.

### C1 · "Pajautā" (mechanism, 18 s)

- **Hook (0–2 s):** Speaker to camera, phone in hand: "Vai zināji, ka cenu veikalā var pajautāt?" — **Cenu var pajautāt.**
- **Body (2–9 s):** "Trilio parāda trīs piemērotākos variantus no veikaliem. Un pie katra ir šī poga." Cut to screen: results card, thumb hovers on **Pieprasīt labāku cenu**.
- **Screen (9–14 s):** Tap, panel opens, e-mail typed, button. Note appears: **Meklējam labāku cenu.** Voice: "Mēs pajautājam izplatītājam. Ja ir lētāk, atsūtām piedāvājumu."
- **Close (14–18 s):** Back to camera: "Ja nav, pateiksim, kad cena kritīs. Bez maksas." — **Bez maksas · trilio.lv**, logo 1 s.

### C2 · "Trīs jautājumi" (the short flow, 20 s)

- **Hook:** Over-the-shoulder, phone on a kitchen table: "Trauku mazgājamā mašīna trīs jautājumos." — **3 jautājumi.**
- **Body:** Screen recording of the flow: household size, built-in or not, budget; results appear. Voice counts the taps: "Cik cilvēku. Iebūvējama vai ne. Budžets. Gatavs."
- **Screen:** Card, tap on **Pieprasīt labāku cenu**. "Un tad lūdzam labāku cenu nekā veikalā."
- **Close:** "Ja atradīsim, piedāvājums būs tavā e-pastā." — **Pieprasīt labāku cenu · trilio.lv**.

### C3 · "Esam jauni" (founder, trust, 22 s)

- **Hook:** Owner to camera, no script feel: "Mēs esam jauns uzņēmums, un tu par mums neko neesi dzirdējis." — **Jauni. Godīgi.**
- **Body:** "Tāpēc īsi: Trilio nepārdod savas preces. Rāda, kas ir veikalos, un secību nenosaka komisija." (This sentence is the site's own "Kā mēs izvēlamies" promise.)
- **Screen:** Card and the tap. "Ja prece patīk, nospied šo, un mēs pajautāsim izplatītājam labāku cenu."
- **Close:** "Dažreiz izdodas, dažreiz ne. Abos gadījumos tu uzzināsi pirmais." — **trilio.lv**.

### C4 · "Pārdevējs" (relatable, humour, 15 s)

- **Hook:** Text-only on black for 1 s: **„Šī cena ir tikai šodien.”** Speaker rolls eyes: "Jā, jā."
- **Body:** "Tā vietā: atrod to pašu modeli Trilio, nospied pogu." Screen: the model, the tap.
- **Screen:** Note **Meklējam labāku cenu.** Voice: "Mēs pajautājam izplatītājam un pasakām, ja ir lētāk."
- **Close:** "Vai kad cena tiešām kritīs. Nevis „tikai šodien”." — **trilio.lv**. (The quoted line is the salesman's, not Trilio's claim; it is the point of the joke. Keep it in quotes on screen.)

### C5 · "Piedāvājums" (the e-mail, proof, 18 s)

- **Hook:** Phone screen, the real Trilio offer e-mail opened (one actual sent offer, with the shopper's name hidden; the saving line "Tā pati prece. Par X € mazāk." as it was, because it is real). Voice: "Šādi izskatās, kad izdodas." — **Tā pati prece. Lētāk.**
- **Body:** Scroll the e-mail: price, delivery days, warranty line. "Tā pati prece, tā pati garantija, mūsu piegāde."
- **Screen:** Cut back to the card: "Sākas ar vienu pogu." Tap.
- **Close:** "Ja lētāk nebūs, pateiksim, kad būs." — **Pieprasīt labāku cenu · trilio.lv**.
- Rule: the number in C5 must be a real offer that was sent; never a mock-up. If there is no real offer yet, C5 waits.

### Ad text (under the video, 100 characters) and CTA

- Primary: "Pieprasi labāku cenu nekā veikalā. Pajautāsim izplatītājam. Bez maksas." (CTA button: *Pieteikties* is TikTok's closest; set display name "Trilio".)
- Variant: "Trīs piemērotākie varianti no veikaliem un viena poga: labāku cenu."
- Variant: "Jauni un godīgi: ja lētāk nebūs, pateiksim, kad cena kritīs."

All three pass `lintAdText` (no superlatives, no percentages, no urgency, no discount claims). Every new line goes through the same lint before upload.

## 7. Production

- Shoot on a phone, vertical, natural light, a kitchen or a hallway with the appliance in the back. One speaker (the owner reads best for C3; anyone for the rest).
- Screen recordings from a real phone on the live site (not the admin, not a test database), with the consent banner already answered. Record at 60 fps; show the thumb.
- Captions: TikTok's auto captions, corrected by hand for ā/š/ķ.
- Music: a TikTok commercial-library track at −18 dB under the voice.
- Deliver 5 videos × 1 cut each for the test; variants of the hook (first 2 s) come in round 2, not now.

## 8. What to measure and when to stop

Read daily in Ads Manager; weekly against the site (Admin → Reklāma and the notify funnel in Statistika).

| Metric | Healthy for the test | Act |
| --- | --- | --- |
| Hook rate (2-s views ÷ impressions) | ≥ 30 % | Below 20 % after 2 000 impressions: pause that creative. |
| CTR (clicks ÷ impressions) | ≥ 0,8 % | Below 0,5 %: pause. |
| Cost per landing page view | ≤ 0,40 € | |
| **Cost per `SubmitForm` (notify tap)** | ≤ 4 € in the test; ≤ 2,50 € to scale | This is the number the test exists for. |
| Confirmed e-mails ÷ taps | ≥ 50 % | Lower means the panel, not the ad; check on mobile. |
| Offers sent ÷ requests, orders ÷ offers | Reported from the CRM | Decides whether the economics work at all. |

Decision after 14 days: scale (×2 budget, add `vacuum`, cut to the 2 best creatives, make 3 hook variants of each) if cost per tap ≤ 4 € and at least one offer converted; iterate creatives for one more round if the hook rate is fine but the tap cost is high; stop if the hook rate is under 20 % across all five.

## 9. Risks and rules

- **Policy:** TikTok rejects "before/after" price claims without proof; C5 uses a real sent offer and the price history page is the proof if asked. No comparison with named shops in ad text.
- **Comments:** reply within a day in Latvian; a question about how Trilio earns gets the honest answer (commission from shops on referrals, margin on own offers; ranking never affected).
- **Honesty:** the lint rules apply to spoken lines too. No "garantēti", no "lētākais", no "tikai šodien" as Trilio's own words.
- **Attribution:** TikTok's dashboard over-counts; trust the site's `ad_landings` with `ttclid` and the UTM for cost per tap.

## 10. Next steps

1. Owner: open Ads Manager and the Business Center; pick the two categories (default: `dish`, `fridge`).
2. Build: TikTok pixel/Events API behind consent, `ttclid` on landings, `SubmitForm` on the notify tap (one PR).
3. Shoot C1–C4 (C5 once a real offer exists), post organically, then Spark the best as the 14-day test.
