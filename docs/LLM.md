# Claude API usage in Trilio

Claude is used in exactly two places. Rankings, tiers, prices, deltas and energy costs are deterministic code (`src/domain/**`) and are never influenced by a model. This is what makes the "Kā mēs izvēlamies un ranžējam?" panel truthful.

| Purpose | Where | When it runs | Cost shape |
|---|---|---|---|
| **Free-text routing** — "Kaut kas cits" text → subcategory + pre-filled answers | `src/services/llm/router.ts`, `POST /api/free-text` | Synchronously, only when the regex table (`free_text_detection` in `categories.json`) finds nothing | A few hundred input tokens (system prompt cached) + ~50 output tokens per request; only for shoppers who type free text |
| **Attribute extraction** — feed title/specs/description → `attributes` + question `tags` | `src/services/llm/extract.ts`, `extract-job.ts` | In the background after ingestion, once per product that has no `extracted_at` | One call per new product; a few hundred products is single-digit euros |

Both go through `callStructured` in `src/services/llm/client.ts`, which is the only file that imports the Anthropic SDK.

## Guardrails (all enforced in code)

1. **Structured output, validated twice.** Every call uses `client.messages.parse` with a Zod schema (`output_config.format`). The parsed result is then validated again against the catalog: the router's pre-fills go through `sanitizeAnswers` (unknown questions and option values are dropped), extraction keeps only the keys in `ATTRIBUTE_KEYS` with the right type and only tags that are real option values of that subcategory. A model answer can never create schema.
2. **Untrusted text is data.** Shopper text and feed text are wrapped in a random-named tag by `wrapUntrusted`, angle brackets are stripped, and the system prompt tells the model to ignore instructions inside. Input is capped (300 chars for routing, 4000 for extraction).
3. **Graceful degradation.** Feature flags off, no API key, daily cap reached, refusal, parse failure, timeout or API error all return "no result": routing falls back to the regex table, extraction leaves the product for the next run. Nothing user-facing breaks.
4. **Daily call cap** per purpose (`LLM_DAILY_CALL_CAP`, default 2000), counted from the `llm_calls` table.
5. **Rate limit** on `/api/free-text`: 10 requests per minute per client address.
6. **Usage log without content.** `llm_calls` stores purpose, model, token counts, duration and outcome. Prompt text and user text are never stored there. Out-of-scope requests are stored in `waitlist_leads` as demand data, as the product spec asks.
7. **Feed attributes win.** Extraction only fills gaps; a value the partner feed provided is never overwritten. Extraction confidence below 60 is stored so the UI can show "nav apstiprināts" instead of treating the value as a hard-filter fact.
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
- Review what the model decided: `select name, attributes, tags, extraction_confidence from products where extracted_at > now() - interval '1 day' order by extraction_confidence;`
- Re-extract a product: `update products set extracted_at = null where id = '…';`
- Spend: `select purpose, date_trunc('day', created_at) d, count(*), sum(input_tokens) in_tok, sum(output_tokens) out_tok, sum(cache_read_tokens) cached from llm_calls group by 1,2 order by 2 desc;`
- Model choice: start with `claude-opus-5-5` at low effort (quality on Latvian product text matters more than speed here). To test a cheaper model, set `LLM_MODEL`, clear `extracted_at` on a sample of 50 products, run `npm run extract -- 50`, and compare against the feed's own attributes where both exist.

## Not using the model for

- Scoring, picking the three options, tiers, "Trilio ieteikums".
- Any price, discount or delivery-date text.
- UI copy or translations at runtime.
- Anything that blocks the results page (extraction is a job; routing has a regex fast path and a 30 s ceiling).

Refusal fallbacks (`fallbacks: "default"`) are not enabled: a refusal on product text is treated as "no result" and degrades like any other failure, which is the behaviour we want here.
