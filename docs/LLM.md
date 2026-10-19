# Claude API usage in Trilio

Claude is used in exactly two places at runtime. Rankings, picks, tiers, prices, deltas, energy costs, the "Vērts zināt" advice and the "Vērts apsvērt" card are deterministic code (`src/domain/**`) and are never influenced by a model. This is what makes the "Kā mēs izvēlamies un prioritizējam?" panel truthful. The rule from `docs/FILTERS_PLAN.md` holds: AI provides data, code does the choosing.

| Purpose | Where | When it runs | Cost shape |
|---|---|---|---|
| **Free-text routing** — "Kaut kas cits" text → subcategory + pre-filled answers (choices, numbers, and `{min, max}` for range questions) | `src/services/llm/router.ts`, `POST /api/free-text` | Synchronously, only when the regex table (`free_text_detection` in `categories.json`) finds nothing | A few hundred input tokens (system prompt cached) + ~50 output tokens per request; only for shoppers who type free text |
| **Attribute extraction** — shop title, spec table, specs and description → missing `attributes` from the subcategory's attribute catalogue | `src/services/llm/extract.ts`, `extract-job.ts`, `catalog-prompt.ts` | In the background after ingestion, once per product that has no `extracted_at` | One call per new product; a few hundred products is single-digit euros |

Both go through `callStructured` in `src/services/llm/client.ts`, which is the only file that imports the Anthropic SDK.

## Attribute extraction

Extraction is the last data source, not the first (`docs/ATTRIBUTES.md`):

1. Ingestion reads each shop's spec table and derives what it can with deterministic code (`normaliseProduct`). Values from the same product at other shops are merged by EAN.
2. Only then, products that have never been extracted (`extracted_at is null`) are sent to Claude, once each.
3. **The prompt is built from the attribute catalogue** (`extractionSystem` in `catalog-prompt.ts`). It lists the subcategory's `key` attributes from `data/attributes.json` with their unit, or the allowed values for enums such as `form`. It is byte-stable per subcategory, so caching works.
4. **The input** is the product title, the stored spec table (`products.spec_table`) as "label: value" lines, the spec line and the description. Together they are capped at 4000 characters and wrapped as untrusted data. A product with no description, spec line or spec table is marked done without a call.
5. **The output** is a list of `{key, value}` plus a confidence. It is validated (guardrail 1) and merged with source `claude` (guardrail 7), so it only fills gaps.

The model is told to report only facts stated in the text, never to infer from brand or model name, and to leave unknown attributes out.

## Guardrails (all enforced in code)

1. **Structured output, validated twice.** Every call uses `client.messages.parse` with a Zod schema (`output_config.format`). The parsed result is then validated again against the catalog: the router's pre-fills go through `sanitizeAnswers` (unknown questions, option values and out-of-range numbers are dropped; range bounds are clamped). Extraction keeps only the subcategory's `key` attributes from `data/attributes.json` with the right type: numbers must be positive and at most 100 000, energy classes must be A–G, and enum values (form, type) must be one of the values the catalogue lists. Extraction no longer produces tags. A model answer can never create schema.
2. **Untrusted text is data.** Shopper text and feed text are wrapped in a random-named tag by `wrapUntrusted`, angle brackets are stripped, and the system prompt tells the model to ignore instructions inside. Input is capped (300 chars for routing, 4000 for extraction).
3. **Graceful degradation.** Feature flags off, no API key, daily cap reached, refusal, parse failure, timeout or API error all return "no result": routing falls back to the regex table, extraction leaves the product for the next run. Nothing user-facing breaks.
4. **Daily call cap** per purpose (`LLM_DAILY_CALL_CAP`, default 2000), counted from the `llm_calls` table.
5. **Rate limit** on `/api/free-text`: 10 requests per minute per client address.
6. **Usage log without content.** `llm_calls` stores purpose, model, token counts, duration and outcome. Prompt text and user text are never stored there. Out-of-scope requests are stored in `waitlist_leads` as demand data, as the product spec asks.
7. **Every other source wins.** Extracted values are stored with source `claude`, the lowest priority in `SOURCE_PRIORITY` (`docs/ATTRIBUTES.md`), and go through `mergeAttributes`. They fill gaps only: a value from the spec table, a feed or a rule is never overwritten, and a later spec table (or EPREL, once built) replaces what Claude wrote. Confidence (0–100) is stored in `extraction_confidence` for review; the job counts results below 60. Ranking does not read it.
8. **Prompt caching.** The system prompts are byte-stable (built from the catalog, no timestamps) and marked `cache_control: ephemeral`, so repeated calls pay ~10 % for the catalog portion.
9. **Low effort, bounded output.** `output_config.effort: "low"`, `max_tokens` 512 (routing) / 1024 (extraction), client timeout 30 s, 2 retries.

## Configuration

```
ANTHROPIC_API_KEY=...        # server-only
LLM_MODEL=claude-opus-5-5    # default; override to measure a cheaper model
LLM_DAILY_CALL_CAP=2000
FEATURE_FREE_TEXT_LLM=1      # routing via Claude when regex finds nothing
FEATURE_LLM_EXTRACT=1        # extraction after each ingestion run
```

Both features ship dark. Turn them on in Railway variables once the key is set.

## Operating

- `npm run extract -- [limit] [subcategoryId]` runs extraction by hand; `npm run ingest -- all` runs it automatically after ingestion when enabled.
- Review what the model decided: `select name, attributes, attribute_sources, extraction_confidence from products where extracted_at > now() - interval '1 day' order by extraction_confidence;`. Keys whose source is `claude` came from the model.
- Re-extract a product: `update products set extracted_at = null where id = '…';`
- Spend: `select purpose, date_trunc('day', created_at) d, count(*), sum(input_tokens) in_tok, sum(output_tokens) out_tok, sum(cache_read_tokens) cached from llm_calls group by 1,2 order by 2 desc;`
- Model choice: start with `claude-opus-5-5` at low effort (quality on Latvian product text matters more than speed here). To test a cheaper model, set `LLM_MODEL`, clear `extracted_at` on a sample of 50 products, run `npm run extract -- 50`, and compare against attributes whose source is `spec_table` where both exist.

## Planned, not built

Both are gated, and neither exists in code yet:

- **EPREL lookup** (source `eprel`, the highest priority). This is not a model call. It is a deterministic lookup in the EU energy-label database by EAN or model, for fridges, freezers, washers, dryers, dishwashers, ovens and hoods. It returns official dimensions, volumes, energy class, kWh/year and noise. It waits for the owner's `EPREL_API_KEY` (placeholder in `.env.example`).
- **Web lookup** (source `claude_web`, the lowest priority). This would use Claude with web search, only for products that still miss a fit-critical value (`fit` in `data/attributes.json`) after every other source. It would search the manufacturer's page by EAN and model code. A value without a source URL would be discarded. It would run once per product, within the daily cap.

Until then, products that still lack fit data are left out of the picks and show up in `/api/status` coverage.

Claude is also used offline, outside the app, to draft question sets for new categories and the brand table (`data/brands.json`). A human reviews both before they ship, and the "Vērts apsvērt" card stays off until the table is marked `reviewed`.

## Not using the model for

- Filtering, scoring, picking the three options, tiers, "Trilio ieteikums", "Vērts apsvērt" and the "Vērts zināt" notes.
- Any price, discount or delivery-date text.
- UI copy or translations at runtime.
- Anything that blocks the results page (extraction is a job; routing has a regex fast path and a 30 s ceiling).

Refusal fallbacks (`fallbacks: "default"`) are not enabled: a refusal on product text is treated as "no result" and degrades like any other failure, which is the behaviour we want here.
