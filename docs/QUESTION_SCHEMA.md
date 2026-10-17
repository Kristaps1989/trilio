# Question schema (`data/categories.json`)

Every subcategory's questions are data. The page that renders a question never knows which category it belongs to. The Zod schema in `src/domain/questions/schema.ts` is the source of truth; a unit test validates the JSON on every CI run.

```jsonc
{
  "groups": [
    {
      "id": "cool",
      "label": "Ledusskapji un saldētavas",
      "icon_svg_path": "M7 2h10…",            // 24×24 stroke path
      "subcategories": [
        {
          "id": "fridge",
          "label": "Ledusskapji",
          "description": "brīvi stāvoši un iebūvējami",
          "custom_flow": false,              // always false now; kept for compatibility
          "budget_steps_eur": [500, 800, 1200],
          "compare_row_labels": ["Izmēri", "Tilpums", …],
          "questions": [ /* Question[] */ ]
        }
      ]
    }
  ],
  "free_text_detection": [{ "subcategory": "handblender", "regex": "rokas blend" }]
}
```

## Question

| Field | Type | Meaning |
|---|---|---|
| `id` | string, unique within the subcategory | Answer key. Legacy ids are `g0`, `g1`…; new ones are descriptive (`niche`, `gas`). |
| `title` | string | The question, Latvian, informal "tu". |
| `why` | string \| null | Shown under "Kāpēc jautājam:". |
| `type` | `"single"` \| `"multi"` \| `"number"` | Single choice auto-advances; multi and number show "Turpināt". |
| `max_select` | int | Multi only. |
| `hard_filter` | boolean | A chosen option **excludes products that contradict it**. It never excludes products that merely exceed it, and never excludes products whose attribute is unknown (they pass with a "nav apstiprināts" note). |
| `showIf` | `{ "q": id, "in": [values] }` or `{ "q": id, "notIn": [values] }` | The question is shown only when the referenced answer matches. Hidden questions are skipped and their answers discarded, unless an `implies` fills them. |
| `help` | string | Revealed by a "Nezinu" button instead of advancing. |
| `input` | `{ min, max, default, unit, step }` | Number questions only. |
| `options` | Option[] | Empty for number questions. |

## Option

| Field | Type | Meaning |
|---|---|---|
| `value` | string, unique within the question | Stored answer. Also the product **tag** the option matches (`product.tags[value]`) unless the subcategory has bespoke matching. |
| `label` | string | Main text. |
| `sublabel` | string \| null | Smaller text in brackets. |
| `card_reason` | string \| null | "Why it fits" line on the result card when the product matches. |
| `table_value` | string \| null | Cell text in the compare table. |
| `passthrough` | boolean | Never filters and never scores ("Nezinu", "Nav svarīgi", "Nē"). Every hard-filter question whose answer can honestly be "I don't know" must have one. |
| `exclusive` | boolean | Multi only: selecting it clears the other selections (e.g. "Nekas no tā"). |
| `implies` | `{ [questionId]: value }` | Answers another (usually hidden) question. Grinder: `espresso` implies `g1 = burr`. |

## Shared trailing questions

Budget, refurbished and urgency are **not** in the JSON. The engine appends them to every subcategory:

1. **Budget**: `budget_steps_eur` as "Līdz X €" options, plus "Cita summa" (number input) and "Budžets nav noteikts". Stored in cents.
2. **Refurbished**: only when the subcategory has refurbished stock right now.
3. **Urgency**: `asap` / `two_weeks` / `no_rush` with computed working-day dates.

## Progress counter

"Jautājums N no M" counts only questions that are currently visible given the answers so far, plus the three trailing questions. M changes when a conditional question appears.
