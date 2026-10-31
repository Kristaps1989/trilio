# Trilio brand

## Logo
- **Mark:** a rounded square (radius 11 on a 40×40 viewBox) containing a 3-bar podium (2nd, 1st, 3rd). The tall middle bar has a dot above it, so it also reads as the letter "i".
  ```svg
  <svg viewBox="0 0 40 40"><rect width="40" height="40" rx="11" fill="#D8F45A"/>
  <rect x="8.5" y="19" width="6.5" height="13" rx="2" fill="#0F2A2E"/>
  <rect x="16.75" y="14" width="6.5" height="18" rx="2" fill="#0F2A2E"/>
  <circle cx="20" cy="9" r="3" fill="#0F2A2E"/>
  <rect x="25" y="23" width="6.5" height="9" rx="2" fill="#0F2A2E"/></svg>
  ```
- **Wordmark:** "trilio" in lowercase, Space Grotesk 700, letter-spacing −0.045em.
- **Versions:** lime mark on dark (primary); dark mark with lime bars on light; bars only on lime. The app icon uses radius 9.
- **Clear space:** ≥ ⅓ of the mark's width around it.
- **Tagline (owner, 31 Oct 2026):** "Daži jautājumi. 3 ieteikumi. Pērc uzreiz vai pieprasi labāku cenu." (EN: "A few questions. 3 picks. Buy now or ask for a better price."). Three beats in the order the shopper lives them; the third beat uses the button's own words, so the line teaches the product. The earlier "Trīs labākie. Bez meklēšanas." is retired: it read as misleading once the better-price request became the point.

## Voice and register (owner, 31 Oct 2026)

- **On the site and in e-mails to a shopper: "tu".** The flow is a one-to-one conversation; buttons are infinitives ("Pieprasīt labāku cenu").
- **In public posts, ads text and profile texts: no pronoun of address.** Statements and infinitives ("Trīs ieteikumi: …", "Var pirkt uzreiz veikalā vai pieprasīt labāku cenu"). Where a pronoun cannot be avoided, "jūs". The tagline's imperatives ("Pērc … pieprasi") are the brand line and stay as they are. The post lint (`src/domain/social/lint.ts`) refuses "tu", "tev", "tavs" in captions.
- **"Bez maksas" only next to the service** (padoms, pieprasījums, paziņojums), never next to "tehnika", "prece" or "ierīce": next to goods it reads as free appliances.
- **Never "labākais piedāvājums" together with "labāka cena".** Trilio finds the most suitable product; the price is what the team works on.
- **People in posts:** "pircējs", never a name, not even a changed one (docs/SOCIAL_PLAN.md §5).
- **Emojis (owner, 31 Oct 2026):** at most two in a post, each with a job: one marking the topic at the start (🏷️ picks and products, 📉 price drop, 💡 advice, 📦 offer, 🔎 what is searched) and 👉 before the Facebook link. Never instead of words, never hype or urgency (🔥 ⏰ 🚨 💥 ‼️ ❗ ⚡). The post lint enforces both.
- **Captions:** the fact first (the first ~125 characters show before "… vairāk"), the words people search for (category, product, "cena"), one question that invites a comment ("… Rakstiet komentāros."), then the link. Five hashtags, Instagram's limit.

## Post images (owner, 31 Oct 2026)

- **One idea per slide.** A large headline, one hero (a numeral, a price, a phone mock-up of the site, a product photo or a category drawing on a lime disc), one line under it. Nothing in boxes; rows are typographic (lime numeral, name, figure on the right, hairline rules).
- **Product photos on white.** A slide about one product shows the shop's photo of it on a white card with rounded corners; category slides show the drawing. Night green stays the ground of every slide.
- **Scale by length.** The headline size follows its length (132 px for a word, down to 54 px for a sentence); prices in lime, 150–190 px; eyebrow in lime small capitals.
- **Carousels:** a counter top right, "Ritini tālāk →" on the cover only, the tagline only on the closing slide, "trilio.lv" bottom right on every slide.

## Social profiles (owner, 31 Oct 2026)

- **Cover:** `assets/brand/facebook-cover.png` (1640×624; the centre 1110 px stays visible on phones). Share image: `public/og.png` (1200×630), same line.
- **Instagram bio:**
  ```
  Daži jautājumi. 3 ieteikumi.
  Pērc uzreiz vai pieprasi labāku cenu 🏷️
  Palīdzam izvēlēties sadzīves tehniku veikalos Latvijā. Padoms bez maksas.
  👇 trilio.lv
  ```
- **Facebook intro:** "Daži jautājumi. 3 ieteikumi. Pērc uzreiz vai pieprasi labāku cenu. Palīdzam izvēlēties sadzīves tehniku veikalos Latvijā; padoms bez maksas."
- **Facebook about:** "Trilio palīdz izvēlēties sadzīves tehniku. Atbildi uz dažiem jautājumiem, un parādīsim trīs tev piemērotākos variantus no veikaliem Latvijā, ar cenu, piegādes laiku un elektrības izmaksām 10 gados. Pērc veikalā uzreiz vai nospied „Pieprasīt labāku cenu”: pajautāsim izplatītājam, un, ja varēsim piedāvāt lētāk, atsūtīsim piedāvājumu. Ja ne, uzrakstīsim, kad cena veikalos samazināsies. Secību nenosaka veikalu komisija. Padoms bez maksas, bez konta."
- **Category:** Shopping & retail (Appliances). **Website:** https://trilio.lv. **Button:** "Learn more" → https://trilio.lv.

## Colours
| Token | Hex | Use |
|---|---|---|
| night-green | `#0F2A2E` | Background, dark text on light |
| lime | `#D8F45A` | Accent, primary buttons, recommendation badge |
| mist | `#F2F5F2` | Light background, text on dark |
| stone | `#A9BDB9` | Secondary text on dark |
| muted-on-white | `#4E605C` | Secondary text on white cards |
| refurbished | `#1E4FB8` / `#DCEBFF` / `#9CC8FF` | **Refurbished items only** |
| over-budget | `#FBEADF` bg, `#8A3209` text, `#E4B48F` dashed border | Over-budget extras |
| best-value | `#F1F8D6` | Compare-table best cell, upgrade delta box |
| warning | `#FFB4A3` | Errors, cancellation |

## Typography
- **Headings, prices, numbers:** Space Grotesk 600/700.
- **Body and UI:** Figtree 400/600/700, body text 16–18 px, line-height 1.5.
- Both are on Google Fonts and cover the Latvian, Lithuanian and Estonian alphabets.

## Components (see prototype)
- **Option row:** min-height 60 px, letter key badge (A, B, C…). The selected state uses a lime border and lime at 18 % opacity.
- **Primary button:** lime background with night-green text, radius 12–14 px, min-height 52–56 px.
- **Cards:** white, radius 20 px, padding 22 px. The recommended card has a 3 px lime ring.
- **Sign-in and wallet buttons:** the prototype uses text placeholders. Use the official Apple and Google button designs in production.
