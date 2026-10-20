# Product attributes (`data/attributes.json`)

Filters, scores, the compare table, the upgrade delta and the "Vērts zināt" notes all read typed product **attributes** (`products.attributes`), such as `height_cm: 185.5`, `form: "combi"` or `no_frost: true`. This file explains where they come from and how to extend them. The intent is in `docs/FILTERS_PLAN.md` Phase 1 and §6.2. Questions refer to attributes through `option.match`, `range.attr` and `input.attr` (`docs/QUESTION_SCHEMA.md`).

The catalogue is validated by the Zod schema in `src/domain/catalog/attributes.ts`. Normalisation lives in `src/domain/catalog/normalise.ts`; both are pure and unit-tested.

## The catalogue

```jsonc
{
  "attributes": {                       // shared by all subcategories
    "height_cm": { "type": "number", "unit": "cm", "labels": ["augstums", "nišas augstums", …] },
    "noise_db":  { "type": "number", "unit": "db", "pick": "max", "labels": […] },
    "energy_class": { "type": "energy_class", "labels": ["energoklase", …] },
    "no_frost":  { "type": "boolean", "labels": […], "true": ["no ?frost", …], "false": ["manuāl", …], "text": ["no ?frost", …] }
  },
  "accessory": ["piederum", "rezerves daļ", "maisiņ", …],   // name patterns of parts and accessories
  "subcategories": {
    "fridge": {
      "key":   ["install", "doors", "height_cm", "width_cm", …], // attributes this subcategory uses
      "fit":   ["install", "height_cm"],                    // fit-critical: missing ⇒ not a pick
      "enums": { "doors": { "values": ["multi", "one", "two"], "rules": [ … ] } },
      "defaultFalse": [],                                   // feature flags false unless stated
      "sanity": { "stems": ["ledussk", "fridge", …], "priceEur": [60, 15000] }
    }
  }
}
```

**Attribute types.**
- `number`: has a `unit`. Supported units are cm, l, kg, w, db, rpm, min, kwh, m3h, gmin, bar, pcs and g.
- `boolean`.
- `string`: `climate_class` is the only one.
- `energy_class`: the 2021 A–G scale. Old classes such as "A+++" are ignored, because they are not comparable.
- **Enums** such as product form or type are not shared attributes. Each subcategory defines its own under `enums`, with its allowed values.

**Fields of a shared attribute.**
- `labels`: the shops' spec-table labels for it, lower case, with no trailing colon.
- `pick: "max"`: takes the largest number of a range, so "108 - 162 m³/h" becomes 162.
- `true` and `false`: patterns that read a boolean from the spec value.
- `text`: patterns that set a boolean to true when they appear anywhere in the product text. When a pattern is missing, that proves nothing.

**Fields of a subcategory.**
- `key`: the attributes the subcategory uses. Normalisation and Claude extraction fill only these, plus a few physical facts the type rules need: size, fridge and freezer volume, and energy use.
- `fit`: the fit-critical attributes. A product missing one is not shown as a pick, and the `recommended` badge needs all of them known. Today the list is set for fridge, freezer, washer, dryer, dish, hob, oven, hood, micro and vacuum. Small appliances have none.
- `enums`: derived values (form, type) with ordered rules, described below.
- `defaultFalse`: feature flags that are false unless a source says otherwise, for example a kettle's `temp_control`.
- `sanity`: the word stems that name the category, and a plausible price range in euros.

## How a product's attributes are built

`normaliseProduct(subcategoryId, { name, category, description, specTable })` is deterministic: the same page always gives the same attributes. Within one product, the first value set for a key wins. The steps run in this order:

1. **Spec table.** Labels are matched against `labels` (`src/services/ingestion/specs/table.ts` reads the table; see `docs/SCRAPING.md`).
   - "Izmēri (G x P x A)" style labels are split by the letters in the label: A = height, P = width, G or D = depth. Values in mm are converted.
   - m79.lv names like "… | Dziļums 54 cm | Mazgāšanas ietilpība 7kg" are read as label/value pairs too.
   - Numbers accept a decimal comma and a space as the thousands separator, and convert units: mm or m to cm, ml to l, g to kg, kW to W, h to min. A value outside the unit's plausible range is dropped.
2. **Booleans from text.** A `text` pattern found in the name, category, description or spec table sets the value to true, with source `rule`.
3. **Derived values.**
   - `volume_l` = fridge volume + freezer volume. For freezers it is the freezer volume alone.
   - `garage_ok` is set when the climate class includes SN, or when the text mentions a garage.
   - Washers and dishwashers: a figure under 150 kWh is the label's kWh per 100 cycles. It is converted to a year at 220 or 280 cycles.
4. **Enums by rule.** The first rule that holds sets the value. A rule can combine:
   - `text`: regexes over the product text;
   - `spec`: a spec-table label and a regex for its value;
   - `num`: conditions on numbers already found, such as `height_cm ≤ 100` meaning compact;
   - `always`: a fallback.

   Order matters: put the specific rules (built-in, side-by-side) before the general ones.
5. **Default false.** Each `defaultFalse` key that is still unset becomes false.

Every value carries its **source**, stored in `products.attribute_sources` (migration `0005_product_specs.sql`, which also adds `products.spec_table` for the raw label → value table).

## Sources and priority

`SOURCE_PRIORITY` in `normalise.ts`; higher wins:

| Source | Priority | What it is | Status |
|---|---|---|---|
| `eprel` | 6 | EU energy-label database, looked up by EAN or model | Built (20 Oct 2026). See [EPREL](#eprel) below. |
| `spec_table` | 5 | The shop's own specification table | Built: euronics.lv, tet.lv, m79.lv, plus generic `<th>/<td>` and `<dt>/<dd>` |
| `feed` | 4 | Attributes a partner feed supplies directly | Built. It is the default when a row carries attributes without sources. |
| `same_ean` | 3 | A value copied from the same product at another shop | Reserved label. In practice, cross-shop filling happens through the merge rule below, and the value keeps its original source. |
| `rule` | 2 | Derived by code (enum rules, text booleans, defaults, conversions) | Built |
| `claude` | 1 | Claude extraction from shop text, gaps only (`docs/LLM.md`) | Built, behind `FEATURE_LLM_EXTRACT` |
| `claude_web` | 1 | Claude with web search, for fit-critical gaps, with a source URL | **Not built** |

### Merge rule

The same product (same EAN, or else brand + normalised model code) is listed by several shops. `mergeAttributes(current, incoming)` decides per key:
- a gap is always filled, so one shop's spec table completes another shop's listing;
- a **stronger** source replaces a weaker one;
- an **equal** source never overwrites, so values do not flip between shops on each run;
- refurbished rows never change the product's descriptive data.

Claude extraction goes through the same merge with source `claude`, so it can only fill gaps. A later spec table, or EPREL, replaces what it wrote.

## Sanity rules

`sanityCheck` runs on every row before it is saved. A rejected row is counted in the run's `rowsRejected` with one of these reasons:

| Reason | Rule |
|---|---|
| `accessory` | The **name** matches an `accessory` pattern (filters, bags, shelves, spare parts, adapters …). |
| `category_mismatch` | The product does not show it belongs to the subcategory. **The shop's category label alone is not trusted**, because shops mis-file products (m79.lv lists toys under coffee machines). It passes only when either: the name, description or spec table contains one of the subcategory's `sanity.stems`; or the spec table states a category-specific key attribute (any `key` attribute other than height, width, depth and weight, from source `spec_table`). The second route keeps tet.lv products whose names are only a model code. |
| `implausible_price` | The price is outside `sanity.priceEur` (for example, a €40 "oven" is a mini oven or an accessory). |

## Coverage

`GET /api/status` returns `coverage`: per subcategory, the number of in-stock products from active, non-sample stores, and the percentage that state each `fit` attribute.

```json
"coverage": { "fridge": { "products": 412, "fit": { "install": 99, "height_cm": 91 } } }
```

The rollout target per category batch is at least 95 % for every fit attribute (`docs/FILTERS_PLAN.md` §6.6). Products that still lack one are left out of the picks and appear in the "Vēl N precēm…" line on the results page.

Product pages read before spec tables were stored (`products.spec_table` is null) count as never seen, so the crawler re-reads them first.

## How to add an attribute

1. Add it to `attributes` with its `type`, `unit` (for numbers) and the spec-table `labels` the shops use. Use lower case with no colon; copy them from a real page (see below). For a boolean, add `true` and `false` value patterns, and `text` patterns if the name often states it.
2. Add the key to each subcategory's `key` list that should use it. Also add it to `fit` if a missing value means the product might not fit. Add it to `defaultFalse` if absence means "no".
3. For a derived type, add an enum under the subcategory's `enums` with `values` and ordered `rules`.
4. Use it in `data/categories.json` (`match`, `range.attr`, `input.attr`, `compare`). A test checks that every referenced key and enum value exists.
5. Add a Latvian label for the results page in `src/i18n/messages/lv.json` (`attr` namespace), plus enum value labels if needed.
6. Add a case to `src/domain/catalog/normalise.test.ts` using a saved real page.

## How to add a shop's spec label

When `/api/status` coverage is low, or `select spec_table from products where …` shows a label we do not read:
1. Take the label exactly as stored in `products.spec_table`. It is already normalised: lower case, single spaces, no trailing colon.
2. Add it to the matching attribute's `labels`. Labels are tried in order, so put a more specific label (for example "trokšņa līmenis mazgāšanas laikā") before a general one.
3. If the shop renders its table with new markup, add a pattern to `PATTERNS` in `src/services/ingestion/specs/table.ts` and a saved page to `src/services/ingestion/specs/__fixtures__/pages.json`, with a test in `table.test.ts`.
4. Re-read the shop (`npm run ingest -- <slug>`). Merged values only replace weaker sources, so nothing better is lost.

## EPREL

The EU energy-label database is the strongest source for what a label states, so its values replace shop spec tables and rules (`src/domain/catalog/eprel.ts`, `src/services/eprel/`).

- **Which products:** in-stock products in the label categories: fridge and freezer (`refrigeratingappliances2019`), washer (`washingmachines2019`, `washerdriers2019`), dryer (`tumbledryers20232534`), dishwasher (`dishwashers2019`), oven (`ovens`) and hood (`rangehoods`), plus the older pre-2019 groups.
- **How:** by EAN first (`GET /api/product/gtin/{ean}`, no key needed), then by model (`GET /api/products/{group}?modelIdentifier=…` with the `X-Api-Key: $EPREL_API_KEY` header). A record counts only when it is published and its brand and model match the product (`sameProduct`: case, spaces and an added article number are ignored).
- **What it fills:** energy class, noise, height/width/depth (refrigerating appliances state mm, the other groups cm), kWh a year (fridges directly; washers and dishwashers from the label's kWh per 100 cycles × 2.2 or 2.8), net volumes, climate class (and `garage_ok` for SN), No Frost (every freezer compartment defrosts automatically), built-in or free-standing, capacity, place settings, spin speed, water use and the dryer technology. Only attributes the subcategory uses are written.
- **When:** the web service's scheduler checks 60 products per 15-minute tick, never-checked first. A found record is refreshed after 90 days, a miss after 30, an error the next day. A refused key stops the run. `npm run ingest -- eprel [limit]` runs a larger batch by hand.
- **Record:** `eprel_lookups` keeps the status, method, group, registration number and the record itself for each product.
- **Limits:** EPREL does not return records of suppliers that have not finished its verification, and many products have no EAN registered there, so the model search (the key) matters.
