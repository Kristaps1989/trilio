import { describe, expect, it } from "vitest";
import { capiBody, capiConfigFromEnv, hashEmail, sendCapiEvent } from "./capi";

// The server copy of a Pixel event: the right endpoint, the e-mail only hashed,
// the same event id as the browser, nothing sent without a token.

const cfg = { pixelId: "1234567890123", token: "TOK", version: "v23.0", testCode: null };
const lead = {
  name: "Lead" as const,
  eventId: "e1",
  url: "https://trilio.lv/rezultati",
  ip: "203.0.113.5",
  userAgent: "UA",
  email: "  Anna@Example.LV ",
  fbp: "fb.1.1.2",
  fbc: null,
  category: "fridge",
  now: new Date("2026-11-01T10:00:00Z"),
};

describe("Conversions API", () => {
  it("needs a dataset id and a token; a test code is optional", () => {
    expect(capiConfigFromEnv({ META_PIXEL_ID: "1234567890123" })).toBeNull();
    expect(capiConfigFromEnv({ META_PIXEL_ID: "abc", META_CAPI_TOKEN: "t" })).toBeNull();
    expect(
      capiConfigFromEnv({
        META_PIXEL_ID: "1234567890123",
        META_CAPI_TOKEN: "t",
        META_CAPI_TEST_CODE: "TEST1",
      }),
    ).toEqual({ pixelId: "1234567890123", token: "t", version: "v23.0", testCode: "TEST1" });
  });

  it("hashes the e-mail the way Meta asks and never sends it in plain text", () => {
    expect(hashEmail("  Anna@Example.LV ")).toBe(hashEmail("anna@example.lv"));
    expect(hashEmail("anna@example.lv")).toMatch(/^[0-9a-f]{64}$/);
    const body = capiBody(cfg, lead);
    expect(JSON.stringify(body)).not.toContain("anna");
    expect(body).toEqual({
      data: [
        {
          event_name: "Lead",
          event_time: 1793527200,
          event_id: "e1",
          action_source: "website",
          event_source_url: "https://trilio.lv/rezultati",
          user_data: {
            em: [hashEmail("anna@example.lv")],
            client_ip_address: "203.0.113.5",
            client_user_agent: "UA",
            fbp: "fb.1.1.2",
          },
          custom_data: { content_category: "fridge" },
        },
      ],
    });
    // The Events Manager test code rides along only while set.
    expect(capiBody({ ...cfg, testCode: "TEST1" }, { ...lead, ip: "unknown", email: null })).toMatchObject({
      test_event_code: "TEST1",
      data: [{ user_data: { client_user_agent: "UA", fbp: "fb.1.1.2" } }],
    });
  });

  it("posts to the dataset's events endpoint; failures are false, never thrown", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const ok = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    expect(await sendCapiEvent(cfg, lead, ok)).toBe(true);
    expect(calls[0]!.url).toBe("https://graph.facebook.com/v23.0/1234567890123/events?access_token=TOK");
    expect(await sendCapiEvent(null, lead, ok)).toBe(false);
    const refused = (async () => new Response("{}", { status: 400 })) as typeof fetch;
    expect(await sendCapiEvent(cfg, lead, refused)).toBe(false);
    const down = (async () => {
      throw new Error("network");
    }) as typeof fetch;
    expect(await sendCapiEvent(cfg, lead, down)).toBe(false);
  });
});
