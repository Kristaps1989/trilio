import { test, expect } from "@playwright/test";

// Prompt caching, end to end (docs/PROMPT_CACHING_PLAN.md). The app runs with
// free-text routing on, against tests/e2e/mock-anthropic.mjs, which caches like
// the real API: identical bytes up to the cache_control marker are a hit.

const MOCK = "http://127.0.0.1:4010";

type Recorded = {
  system: { type: string; text: string; cache_control?: { type: string } }[];
  user: string;
  usage: { cache_read_input_tokens: number; cache_creation_input_tokens: number };
};

async function sentWith(request: import("@playwright/test").APIRequestContext, marker: string) {
  const all = (await (await request.get(`${MOCK}/__requests`)).json()) as Recorded[];
  return all.filter((r) => r.user.includes(marker));
}

test("a regex hit asks no model; other requests share one cached system prompt", async ({
  request,
}, info) => {
  // Letters only: a number in the text is what makes a regex hit ask the model for pre-fills.
  const id = `${info.project.name}x${Date.now()}`.replace(/\d/g, (d) => "abcdefghij"[Number(d)]!);
  const ask = (text: string) => request.post("/api/free-text", { data: { text } });

  // The regex table knows the category: no model call at all, so no cache write for nothing.
  const regex = await (await ask(`vajag rokas blenderi zupām ${id}-regex`)).json();
  expect(regex).toMatchObject({ subcategoryId: "handblender" });
  expect(await sentWith(request, `${id}-regex`)).toHaveLength(0);

  // Two different requests the regex table cannot place: both go to the model.
  const first = await (await ask(`kaut kas virtuvei ${id}-a`)).json();
  const second = await (await ask(`e2e-washer ${id}-b`)).json();
  expect(first).toMatchObject({ subcategoryId: null });
  expect(second).toMatchObject({ subcategoryId: "washer", groupId: "laundry" });

  const [a] = await sentWith(request, `${id}-a`);
  const [b] = await sentWith(request, `${id}-b`);
  // One breakpoint, on the frozen system prompt; byte-identical between requests.
  expect(a!.system).toHaveLength(1);
  expect(a!.system[0]!.cache_control).toEqual({ type: "ephemeral" });
  expect(JSON.stringify(b!.system)).toBe(JSON.stringify(a!.system));
  expect(a!.system[0]!.text.length).toBeGreaterThan(2000); // well above the 512-token minimum
  // The shopper's text is after the breakpoint, never in the cached prefix.
  expect(a!.system[0]!.text).not.toContain(id);
  // So the second request reads the cache.
  expect(b!.usage.cache_read_input_tokens).toBeGreaterThan(0);
  expect(b!.usage.cache_creation_input_tokens).toBe(0);
});
