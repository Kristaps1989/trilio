# Markets and locales

One deployment serves one market. `MARKET` (`LV` default, `LT`, `EE`) decides:

| | LV | LT | EE |
|---|---|---|---|
| Stores shown | `stores.country = 'LV'` | `'LT'` | `'EE'` |
| Public holidays for delivery dates | Latvian | Lithuanian | Estonian |
| UI language | `lv` | `lt` | `et` |
| Time zone | Europe/Riga | Europe/Vilnius | Europe/Tallinn |

`src/i18n/market.ts` is the single place this mapping lives. Partner shops for a new market are added as `stores` rows with that country (see `docs/RUNBOOK.md`).

## Translation workflow

- `src/i18n/messages/lv.json` is the source of truth. Every string the UI shows lives there (CLAUDE.md: no literal strings in components).
- `lt.json` and `et.json` are scaffolds produced by `python3 -I scripts/scaffold-locales.py`: same keys, Latvian text, and `"__status": "pending_translation"`. Run the script again after adding keys; existing translations are kept.
- At runtime any key missing from a locale file falls back to Latvian (`src/i18n/request.ts`), so a partially translated file is safe to deploy.
- Latvian grammar helpers (dative dates, decimal comma, thin-space thousands, "599 €") are in `src/i18n/format.ts`. Lithuanian and Estonian need their own date forms before launch; the formatters are the place to branch on `currentMarket().locale`.

## Launching LT or EE

1. Translate `lt.json` / `et.json` (remove `__status` when complete).
2. Add the market's date formatting to `format.ts`.
3. Add partner stores with `country = 'LT'`/`'EE'` and their feeds.
4. Deploy a second Railway service (or environment) with `MARKET=LT`, its own domain and `APP_URL`.
5. SEO landing pages (`/kategorija/…`) pick up the market automatically; the sitemap is per deployment.
