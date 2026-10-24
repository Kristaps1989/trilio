# Google Analytics

Trilio uses Google Analytics 4 (GA4) to see which sections, categories,
questions and buttons people use. It is **opt-in**: nothing loads and no
cookie is set until the visitor clicks "Atļaut" in the consent banner, as
EU law requires. "Neatļaut" is the same size and colour (CLAUDE.md rule 4).
The choice can be changed from "Sīkdatņu iestatījumi" in every page footer;
withdrawing it deletes the GA cookies.

Only visitors who accept are counted, so treat the numbers as a sample:
compare shares and trends, not absolute totals.

For totals, the admin's **Statistika** page (`/admin/statistika`) has Trilio's own
counts. They need no consent because they use no cookies: a daily-rotating hash
of IP and browser, raw rows kept for 35 days, then daily totals only
(docs/ADMIN_AND_OFFERS_PLAN.md §3).

## 1. Create the property

1. Open [analytics.google.com](https://analytics.google.com) with the
   company Google account, **Admin → Create → Property**: name `Trilio`,
   time zone Latvia, currency euro.
2. **Business details** and objectives: anything; they only change the menus.
3. **Data stream → Web**: URL `https://trilio.lv`, name `trilio.lv`. Turn
   **Enhanced measurement off**: Trilio sends its own page views and clicks,
   and the automatic ones would double-count and send full URLs.
4. Copy the **Measurement ID** (`G-…`).
5. **Admin → Data collection and modification → Data retention**: set
   event data to **14 months** (the privacy policy says so).
6. **Admin → Data collection**: keep **Google signals off**.

## 2. Turn it on

Railway, web service (`trilio`), Variables:

```
GA_MEASUREMENT_ID="G-XXXXXXXXXX"
```

Deploy. The banner appears on the next visit. Leave the variable empty to
switch analytics off completely (no banner, no Google hosts in the CSP).

## 3. Register the custom dimensions

GA4 only shows event parameters in reports after you register them.
**Admin → Custom definitions → Create custom dimension**, scope **Event**,
one per row:

| Dimension name | Event parameter | What it holds |
|---|---|---|
| Section | `section` | `home`, `choose`, `results`, `landing`, `radar`, `free_text`, `model_check`, `sign_in`, `account`, `payment`, `legal` |
| Subcategory | `subcategory` | `fridge`, `washer`, `kettle`, … |
| Click label | `label` | Visible text of the button or link |
| Click element | `element` | `button`, `a`, `radio`, `checkbox` |
| Click target | `link` | Path for internal links, host for external ones |
| Question | `question` | Question id answered |
| Option | `option` | Option chosen |
| Shop | `store` | Shop of the offer opened |
| Tier | `tier` | `budget`, `mid`, `top` or `none` |
| Recommended | `recommended` | `yes` when the offer was "Trilio ieteikums" |
| Refurbished | `refurbished` | `yes` for the refurbished block |
| Price (EUR) | `price_eur` | Offer price, rounded |

Data appears in reports about a day after registering.

## What is sent

| Event | When | Parameters |
|---|---|---|
| `page_view` | Every page, also client-side navigation | `section`, `subcategory`, path only (no query string) |
| `ui_click` | Any button, link, option or checkbox | `label`, `element`, `link`, `section`, `subcategory` |
| `answer_question` | An answer option in the question flow | `question`, `option`, `section`, `subcategory` |
| `priority_tapped` | A pill in "Kas tev svarīgāk?" on the results page | `priority` (option value or `any`), `section`, `subcategory` |
| `why_not_opened` | Opening "Kāpēc ne šie?" | `section`, `subcategory` |
| `confidence_answer` | "Jā" / "Nē, kaut kā pietrūka" under the results | `answer`, `section`, `subcategory` |
| `select_offer` | "Pirkt …" on a result card (leaves to the shop) | `store`, `tier`, `recommended`, `refurbished`, `price_eur`, `section`, `subcategory` |

Never sent: query strings (answers, free text, search), typed text, email
addresses, account ids. The consent banner itself is not tracked.

## Useful reports

- **Most used sections and categories:** Reports → Engagement → Pages and
  screens, then switch the dimension to *Section* or *Subcategory*.
- **Buttons:** Reports → Engagement → Events → `ui_click`, add *Click label*
  and *Section*.
- **Where people drop out:** Explore → Funnel exploration with steps
  `page_view` (section = choose) → `answer_question` → `page_view`
  (section = results) → `select_offer`. Break down by *Subcategory*.
- **Which answers people pick:** Explore → Free form, rows *Question* and
  *Option*, filter event `answer_question`, value = event count.
- **Shops and tiers that get clicks:** event `select_offer` by *Shop*,
  *Tier* and *Recommended*. This is also the basis for affiliate reporting.

## Adding tracking to a new element

Any clickable element is tracked as `ui_click` automatically. For a named
event, add data attributes; no client code is needed:

```html
<a href="…" data-ga-event="select_offer" data-ga-param-store="Tet">…</a>
```

`data-ga-ignore` on an element or its parent turns tracking off for it.
The logic is in `src/ui/analytics/Analytics.tsx` and the pure helpers in
`src/domain/analytics/page.ts`.
