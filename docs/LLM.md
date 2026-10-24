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
2. Only then, products that have never been extracted (`extracted_at is null`) are sent to Claude, once each, in subcategory order (so the cached system prompt is reused). Three things keep the bill small (21 Oct 2026, after three days of Opus extraction cost about $16):
   - a product whose extractable keys are all filled already (spec table, feed, rules, EPREL) is marked done without a call (`extraction_model = 'not-needed'`);
   - the call names only the missing keys, so the answer is short;
   - products in the energy-label categories wait up to 3 days for their EPREL lookup, which fills most keys for free.
3. **The prompt is built from the attribute catalogue** (`extractionSystem` in `catalog-prompt.ts`). It lists the subcategory's `key` attributes from `data/attributes.json` with their unit, or the allowed values for enums such as `form`. It is byte-stable per subcategory, so caching works.
4. **The input** is the product title, the stored spec table (`products.spec_table`) as "label: value" lines, the spec line and the description. Together they are capped at 4000 characters and wrapped as untrusted data. A product with no description, spec line or spec table is marked done without a call.
5. **The output** is a list of `{key, value}` plus a confidence. It is validated (guardrail 1) and merged with source `claude` (guardrail 7), so it only fills gaps.

The model is told to report only facts stated in the text, never to infer from brand or model name, and to leave unknown attributes out.

## Guardrails (all enforced in code)

1. **Structured output, validated twice.** Every call uses `client.messages.parse` with a Zod schema (`output_config.format`). The parsed result is then validated again against the catalog: the router's pre-fills go through `sanitizeAnswers` (unknown questions, option values and out-of-range numbers are dropped; range bounds are clamped). Extraction keeps only the subcategory's `key` attributes from `data/attributes.json` with the right type: numbers must be positive and at most 100 000, energy classes must be A–G, and enum values (form, type) must be one of the values the catalogue lists. Extraction no longer produces tags. A model answer can never create schema.
2. **Untrusted text is data.** Shopper text and feed text are wrapped in a random-named tag by `wrapUntrusted`, angle brackets are stripped, and the system prompt tells the model to ignore instructions inside. Input is capped (300 chars for routing, 4000 for extraction).
3. **Graceful degradation.** Feature flags off, no API key, daily cap reached, refusal, parse failure, timeout or API error all return "no result": routing falls back to the regex table, extraction leaves the product for the next run. Nothing user-facing breaks.
4. **Daily call cap** per purpose (`LLM_DAILY_CALL_CAP`, default 300), counted from the `llm_calls` table, so the web service and the cron service share one cap.
5. **Rate limit** on `/api/free-text`: 10 requests per minute per client address.
6. **Usage log without content.** `llm_calls` stores purpose, model, token counts, duration and outcome. Prompt text and user text are never stored there. Out-of-scope requests are stored in `waitlist_leads` as demand data, as the product spec asks.
7. **Every other source wins.** Extracted values are stored with source `claude`, the lowest priority in `SOURCE_PRIORITY` (`docs/ATTRIBUTES.md`), and go through `mergeAttributes`. They fill gaps only: a value from the spec table, a feed or a rule is never overwritten, and a later spec table (or EPREL, once built) replaces what Claude wrote. Confidence (0–100) is stored in `extraction_confidence` for review; the job counts results below 60. Ranking does not read it.
8. **Prompt caching** (`docs/PROMPT_CACHING_PLAN.md`). The routing system prompt (~4 700 tokens: catalogue and questions) is byte-stable and carries the only `cache_control` breakpoint; the shopper's text comes after it in the user message, so repeated calls read the prefix at ~10 %. Routing skips the model when the regex table already knows the category and the text has no number to pre-fill, so no cache write is wasted. Extraction prompts (200–360 tokens per subcategory) are below the 512-token minimum and carry no marker. TTL: `LLM_CACHE_TTL` (5m default, 1h). The `llm today` log line shows each purpose's `cacheHitRate`; the e2e suite runs against a mock Messages API that caches by prefix and fails if the prefix stops being stable.
9. **Low effort, bounded output.** `output_config.effort: "low"`, `max_tokens` 512 (routing) / 1024 (extraction), client timeout 30 s, 2 retries.

## Configuration

```
ANTHROPIC_API_KEY=...        # server-only
LLM_MODEL=claude-haiku-5-5   # default; set the same on every service with the key
LLM_DAILY_CALL_CAP=300
LLM_CACHE_TTL=5m            # 1h only for free-text traffic 5–60 min apart
FEATURE_FREE_TEXT_LLM=1      # routing via Claude when regex finds nothing
FEATURE_LLM_EXTRACT=1        # extraction after each ingestion run
```

Both features ship dark. Turn them on in Railway variables once the key is set.

## Operating

- `npm run extract -- [limit] [subcategoryId]` runs extraction by hand; `npm run ingest -- all` runs it automatically after ingestion when enabled.
- Review what the model decided: `select name, attributes, attribute_sources, extraction_confidence from products where extracted_at > now() - interval '1 day' order by extraction_confidence;`. Keys whose source is `claude` came from the model.
- Re-extract a product: `update products set extracted_at = null where id = '…';`
- Spend: after each run with extraction the log shows `llm today: [{purpose, model, calls, failed, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, cacheHitRate, estimatedUsd}]` (an estimate from the price list in `client.ts`; the Claude Console has the billed amount). By day: `select purpose, date_trunc('day', created_at) d, count(*), sum(input_tokens) in_tok, sum(output_tokens) out_tok, sum(cache_read_tokens) cached from llm_calls group by 1,2 order by 2 desc;`
- Model choice: `claude-haiku-5-5` by default since 21 Oct 2026 (Opus cost about 40 times more per product, and the output is validated against the catalogue either way). To compare models, set `LLM_MODEL`, clear `extracted_at` on a sample of 50 products, run `npm run extract -- 50`, and compare against attributes whose source is `spec_table` where both exist.

## Other data sources

- **EPREL lookup** (source `eprel`, the highest priority) is built and is not a model call: `src/services/eprel`, see `docs/ATTRIBUTES.md`. Extraction waits for it in the energy-label categories.

## Planned, not built

- **Web lookup** (source `claude_web`, the lowest priority). This would use Claude with web search, only for products that still miss a fit-critical value (`fit` in `data/attributes.json`) after every other source. It would search the manufacturer's page by EAN and model code. A value without a source URL would be discarded. It would run once per product, within the daily cap.

Until then, products that still lack fit data are left out of the picks and show up in `/api/status` coverage.

Claude is also used offline, outside the app, to draft question sets for new categories and the brand table (`data/brands.json`). A human reviews both before they ship, and the "Vērts apsvērt" card stays off until the table is marked `reviewed`.

Label-only facts are never asked from the model, so a guess can never become a warranty or a model year: `warranty_months`, `model_year`, `discontinued`, `noise_class`, `condensation_cls`, `repairability`, `moisture_pct` (`NOT_EXTRACTED` in `catalog-prompt.ts`). They come from EPREL and shop spec tables only.

## Not using the model for

- Filtering, scoring, picking the three options, tiers, "Trilio ieteikums", "Vērts apsvērt" and the "Vērts zināt" notes.
- Any price, discount or delivery-date text.
- UI copy or translations at runtime.
- Anything that blocks the results page (extraction is a job; routing has a regex fast path and a 30 s ceiling).

Refusal fallbacks (`fallbacks: "default"`) are not enabled: a refusal on product text is treated as "no result" and degrades like any other failure, which is the behaviour we want here.
