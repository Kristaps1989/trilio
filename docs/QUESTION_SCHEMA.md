# Question schema (`data/categories.json`)

Every subcategory's questions are data. The page that renders a question never knows which category it belongs to. The Zod schema in `src/domain/questions/schema.ts` is the source of truth; a unit test validates the JSON on every CI run. Answers are matched against product **attributes**, whose vocabulary is `data/attributes.json` (see `docs/ATTRIBUTES.md`).

```jsonc
{
  "note": "…",                                  // optional
  "groups": [
    {
      "id": "cool",
      "label": "Ledusskapji un saldētavas",
      "icon_svg_path": "M7 2h10…",            // optional, 24×24 stroke path
      "subcategories": [
        {
          "id": "fridge",
          "label": "Ledusskapji",
          "description": "brīvi stāvoši un iebūvējami",
          "budget_steps_eur": [500, 800, 1200],  // price presets, ascending
          "compare": ["form", "height_cm", "volume_l", "energy_class", …],
          "questions": [ /* Question[] */ ]
        }
      ]
    }
  ],
  "free_text_detection": [{ "subcategory": "handblender", "regex": "rokas blend" }]
}
```

`custom_flow` and `compare_row_labels` no longer exist. Every subcategory, fridges and vacuums included, uses this schema.

## Subcategory

| Field | Type | Meaning |
|---|---|---|
| `id`, `label`, `description` | string | `description` may be null. |
| `budget_steps_eur` | int[], at least one | Quick presets under the price slider, ascending (a test checks the order). |
| `compare` | string[] | Attribute keys, in order, shown in the compare table and used by the upgrade delta. Each must be an attribute or enum in `data/attributes.json` (tested). |
| `questions` | Question[] | In flow order. Ids are unique; `showIf` may only reference an earlier question. |

## Question

| Field | Type | Meaning |
|---|---|---|
| `id` | string, unique within the subcategory | Answer key, descriptive (`form`, `niche`, `household`). `budget` is reserved for the price screen. |
| `title` | string | The question, Latvian, informal "tu". |
| `why` | string \| null | Shown under "Kāpēc jautājam:". |
| `type` | `"single"` \| `"multi"` \| `"number"` \| `"range"`, default `single` | Single choice pre-selects a default and auto-advances. Range and number questions have no options. |
| `stage` | `"flow"` \| `"results"`, default `flow` | `flow`: asked before results. `results`: a chip on the results page (priorities). |
| `up_front_reason` | `"fit"` \| `"price"` \| `"kind"` | **Required for every flow question** (schema and test). `fit`: a wrong answer means it does not fit or work. `kind`: changes which kind of product is right. `price`: sets the price range. If the honest answer to "what goes wrong if we don't ask?" is "nothing the results page can't fix", the question belongs in `results`. |
| `max_select` | int | Required for multi. |
| `hard_filter` | boolean | See "Matching" below. |
| `showIf` | `{ "q": id, "in": [values] }` or `{ "q": id, "notIn": [values] }` | The question is shown only when the referenced earlier answer matches. With `notIn`, an unanswered dependency counts as "not in". Hidden questions are skipped and their answers discarded, unless an `implies` fills them. |
| `help` | string | Revealed by a "Nezinu" button instead of advancing. |
| `input` | Number input, below | Number questions only. |
| `range` | Range, below | Range questions only. |
| `options` | Option[] | At least two for single and multi; empty for number and range. Values are unique. |

### Number input (`type: "number"`)

`{ min, max, default, unit, step = 1, attr?, toleranceBelow?, toleranceAbove? }`

Used for a built-in niche height. With `attr`, a product passes when its value is within `answer − toleranceBelow` … `answer + toleranceAbove`. The fridge niche, for example, accepts products up to 6 cm lower and 0,5 cm higher than the niche. The answer is stored as a number.

### Range (`type: "range"`)

`{ attr, unit, min, max, step = 1, bound = "both", presets?, toleranceAbove? }`

A slider over one attribute. `bound: "max"` shows one handle, an upper limit (height, depth). `presets` are quick values. A product passes when `min ≤ value ≤ max + toleranceAbove`. The answer is `{ min?, max? }`; a missing bound means no limit, and `{}` (or `"any"` from the client) means "Nav ierobežojuma". Values are clamped to the slider, and with `bound: "max"` only `max` is kept.

## Option

| Field | Type | Meaning |
|---|---|---|
| `value` | string, unique within the question | Stored answer. |
| `label` | string | Main text. |
| `sublabel` | string \| null | Smaller text under the label. |
| `card_reason` | string \| null | "Why it fits" line on the result card when the product matches. |
| `table_value` | string \| null | Optional cell text. |
| `match` | `[{ attr, eq?, in?, lte?, gte? }, …]` | Conditions a product must meet for this answer, **all of them**. `eq` takes a string, number or boolean; `in` a list of strings; `lte`/`gte` numbers. `attr` must be an attribute or enum in `data/attributes.json`, and an enum `eq` must be one of its values (tested). |
| `illustration` | string | Picture-card drawing name (`src/ui/illustrations/drawings.tsx`). Every non-passthrough option of a hard single-choice flow question must have one (core rule 3, tested). A test also checks that each name has a drawing and that no drawing is unused. |
| `passthrough` | boolean | Never filters and never scores ("Nezinu", "Mājā", "Atsevišķi", "Nē"). Every "Nezinu" / "Nav svarīgi" option must be passthrough, and every option of a hard choice question must have either `match` or `passthrough` (tested). |
| `exclusive` | boolean | Multi only: selecting it clears the other selections. |
| `implies` | `{ [questionId]: value }` | Answers another, usually hidden, question. The target and value must exist (schema). |

## Matching

`src/domain/catalog/match.ts` evaluates a condition three ways: **true**, **false**, or **unknown** when the product does not state the attribute.

- **Hard filter** (`hard_filter: true`):
  - a product that contradicts the answer is excluded;
  - unknown on a **fit-critical** value keeps the product out of the picks, but it is counted, and the results page offers "Rādīt arī tās" (show them too). Fit-critical means the question's `up_front_reason` is `fit`, or the attribute is in the subcategory's `fit` list in `attributes.json`;
  - unknown on anything else lets the product through, with "nav zināms: …" on the card.
- **Soft** (`hard_filter: false`): a matched option adds score: +12, or +15 and +12 for the first and second priority. It never excludes. A soft question whose options have no `match` (coffee `cups`) filters and scores nothing; it feeds the "Vērts zināt" advice.
- Multi answers: every chosen option's conditions must hold.
- Options without `match` on a hard question fall back to the legacy rule: the option value is compared with `product.tags`. New data should always use `match`.

## Skips, defaults and counts

`src/domain/flow/insight.ts` decides per screen, from the products in stock:
- **Live counts:** how many products each option would leave.
- **Default:** the option most products fit. A passthrough option is used when nothing is clearly more common.
- **Skip:**
  - a question whose options all leave the same products;
  - a hard, range or number question that fewer than 50 % of the remaining products can answer (`MIN_COVERAGE`).

  A soft question without conditions is always asked.

## The trailing price question

The only question not in the JSON is the price screen (`budget`), which the engine appends after every subcategory's flow questions:
- a two-handle slider over real prices, with a histogram;
- it opens on the 20th–80th percentile, rounded outward to €10;
- `budget_steps_eur` are the presets.

The answer is `{ min?, max? }` in cents, or `"none"` ("Budžets nav noteikts"). A bare number is read as a maximum (old links, landing pages).

Priorities (`stage: "results"`), brands with "only these brands", urgency and refurbished are results-page chips (`src/app/rezultati/FilterBar.tsx`), not flow screens. Brands, urgency, refurbished and "show products with missing data" are settings stored next to the answers in the URL state (`src/domain/flow/state.ts`), not questions.

## Progress counter

"Jautājums N no M" counts the visible flow questions that matter for the current stock, plus the price screen. M changes when a conditional question appears or one is skipped.
