# Prompt caching: review and plan

The Claude Console reported a low prompt-cache hit rate ("could save up to 32 %", 23 Oct 2026). This review follows Anthropic's prompt-caching guide (https://platform.claude.com/docs/en/build-with-claude/prompt-caching).

## What the guide says that matters here

- Caching is a **prefix match**: `tools` → `system` → `messages`. One changed byte invalidates everything after it.
- A marker on the last system block caches the system prompt. Per-request text goes after the breakpoint.
- There is a **minimum cacheable prefix**: 512 tokens on Claude Haiku 5.5, Sonnet 5.5 and Opus 5.5. A shorter prefix silently does not cache.
- **Cost:**
  - a write costs 1.25× (5-minute TTL) or 2× (1-hour TTL);
  - a read costs about 0.1×;
  - with the 5-minute TTL, two requests sharing the prefix within 5 minutes break even;
  - a write that is never read is a 25 % surcharge.
- **Verify** with `usage.cache_read_input_tokens`, and keep a standing check, because caching regressions are silent.

## Findings in Trilio

| Call | Cached prefix | Traffic | Verdict |
|---|---|---|---|
| Free-text routing (`ROUTER_SYSTEM`, all categories and questions) | ~4 700 tokens, byte-stable, marker on system | Rare and spread out. It was also called for **every regex hit**, only for pre-fills. The hourly production smoke test sends one such request, so every hour 4 700 tokens were written at 1.25× and never read. | Most writes are wasted |
| Attribute extraction (per-subcategory system prompt) | 200–360 tokens | Bursts after ingestion | Below the 512-token minimum, so it **never caches**, whatever the marker. Until 21 Oct this also ran on Opus with four parallel calls. |

## Changes

1. **Routing: no model call when the regex table already knows the category**, unless the text contains a number (a budget or a size worth pre-filling). This drops most routing calls, including the smoke test's. It makes them faster too.
2. **Routing stays on one explicit breakpoint**, the frozen system prompt with the 5-minute TTL. The 1-hour TTL only pays off with several requests an hour 5–60 minutes apart, which current traffic does not have. `LLM_CACHE_TTL=1h` switches it if traffic grows that way.
3. **Extraction: no cache marker.** The per-subcategory prompts are below the minimum. Padding them to 512 tokens would cost more per call than it saves (at 0.1×, a padded cached prefix costs about what the short uncached one does). The code says why, so nobody "fixes" it back.
4. **Monitoring:** the daily `llm today` log line reports each purpose's **cache hit rate**: cached tokens read ÷ all prompt tokens.
5. **Standing checks**, as the guide advises:
   - **Unit:** the routing system prompt is identical across calls; the marker sits only on the system block; the per-request text is in the user message.
   - **E2E:** the app talks to a local mock of the Messages API. The mock caches like the real one: it compares the bytes of the system prompt up to the marker.
     - a regex hit makes no model call;
     - two different free-text requests share the cached prefix, so the second is logged with `cache_read_input_tokens > 0`;
     - a prefix that changed between requests would fail the test.
