# Markets and locales

One deployment serves one market. `MARKET` (`LV` default, `LT`, `EE`) decides:

| | LV | LT | EE |
|---|---|---|---|
| Stores shown | `stores.country = 'LV'` | `'LT'` | `'EE'` |
| Public holidays for delivery dates | Latvian | Lithuanian | Estonian |
| UI language | `lv` | `lt` | `et` |
| Time zone | Europe/Riga | Europe/Vilnius | Europe/Tallinn |

`src/i18n/market.ts` is the single place this mapping lives. Partner shops for a new market are added as `stores` rows with that country (see `docs/RUNBOOK.md`).

## English (every market)

Every deployment also serves English under `/en` (docs/ENGLISH_AND_ACCESSIBILITY_PLAN.md):

- **Addresses.** The market's own language has no prefix (`/izvelies`); English is `/en/izvelies`, with the same path words. `/lv/…` redirects to the unprefixed page. `src/proxy.ts` does the mapping: unprefixed paths are served by the `[locale] = "lv"` routes, which show the market's own language.
- **Choosing.** Only the URL decides the language; there is no redirect by browser language. The header switch ("EN" / "LV") opens the same page and query in the other language and stores the choice in the `trilio_lang` cookie, so the next visit to `/` opens in it. Signing in remembers the page's language too.
- **Links and redirects.** Use `Link`, `useRouter` and `usePathname` from `src/i18n/navigation.ts`, and `redirect(await localPath("/konts"))` on the server (`src/i18n/path.ts`). The admin stays Latvian and has no `/en` address.
- **Formats.** `src/i18n/format.ts` takes an optional locale: "€1,079", "59.5 cm", "Wednesday, 28 October" in English. Server code needs nothing extra (the request's language is stored by `initLocale`/`getRequestConfig`); client components pass `useUiLocale()`; jobs pass the recipient's language.
- **Category texts.** `data/categories.en.json` holds the English text of `categories.json`, keyed by group, subcategory, question and option ids; `getSubcategory(id, "en")` and the other catalog functions overlay it. Rules stay in `categories.json` only. `catalog.test.ts` fails if a text is untranslated or an id is unknown.
- **E-mails.** Sent in `users.locale` (set at sign-up from the page language, changeable on the account page): billing, wishlist digest, personal offers and order e-mails, with `/en` links.
- **Legal texts.** Translated for convenience; each English legal page says the Latvian text is binding and links to it. Invoices stay in Latvian.
- **Product names** are shown as the shops write them, marked `lang="lv"`.
- **SEO.** Every indexable page has a canonical in its own language and `hreflang` alternates (`lv`, `en`, `x-default`); the sitemap lists both languages.
- **Checks.** `src/i18n/messages.test.ts`: `en.json` has exactly the keys of `lv.json` (minus `admin`) and no unknown placeholders.

## Translation workflow

- `src/i18n/messages/lv.json` is the source of truth. Every string the UI shows lives there (CLAUDE.md: no literal strings in components).
- `en.json` is a full translation; add the English text together with every new Latvian key (the test above fails otherwise).
- `lt.json` and `et.json` are scaffolds produced by `python3 -I scripts/scaffold-locales.py`: same keys, Latvian text, and `"__status": "pending_translation"`. Run the script again after adding keys; existing translations are kept.
- At runtime any key missing from a locale file falls back to Latvian (`src/i18n/request.ts`), so a partially translated file is safe to deploy.
- Latvian grammar helpers (dative dates, decimal comma, thin-space thousands, "599 €") are in `src/i18n/format.ts`. Lithuanian and Estonian need their own date forms before launch; the formatters are the place to branch on `currentMarket().locale`.

## Launching LT or EE

1. Translate `lt.json` / `et.json` (remove `__status` when complete).
2. Add the market's date formatting to `format.ts`.
3. Add partner stores with `country = 'LT'`/`'EE'` and their feeds.
4. Deploy a second Railway service (or environment) with `MARKET=LT`, its own domain and `APP_URL`.
5. SEO landing pages (`/kategorija/…`) pick up the market automatically; the sitemap is per deployment.
