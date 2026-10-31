import { describe, expect, it } from "vitest";
import { metaConfigFromEnv, metaProvider } from "./meta";
import { socialProvider } from "./index";

// The Graph API client against a fake fetch: the right endpoints, the page
// token, Instagram's container-then-publish, and errors as text.

type Call = { method: string; url: string; body: Record<string, string> };

function fakeFetch(answers: (c: Call) => { status?: number; json: unknown }) {
  const calls: Call[] = [];
  const http = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = Object.fromEntries(
      method === "GET" ? new URL(url).searchParams : new URLSearchParams(String(init?.body ?? "")),
    );
    const c = { method, url: url.split("?")[0]!, body };
    calls.push(c);
    const a = answers(c);
    return new Response(JSON.stringify(a.json), { status: a.status ?? 200 });
  }) as typeof fetch;
  return { http, calls };
}

const cfg = { pageId: "PAGE", igUserId: "IG", token: "SYS", version: "v23.0" };
const G = "https://graph.facebook.com/v23.0";
const noWait = async () => {};

describe("meta config", () => {
  it("needs all three values and defaults the version", () => {
    expect(metaConfigFromEnv({ META_PAGE_ID: "1", META_IG_USER_ID: "2" })).toBeNull();
    expect(
      metaConfigFromEnv({ META_PAGE_ID: "1", META_IG_USER_ID: "2", META_SYSTEM_USER_TOKEN: "t" }),
    ).toEqual({
      pageId: "1",
      igUserId: "2",
      token: "t",
      version: "v23.0",
    });
  });

  it("is off without the feature flag, mock on request", () => {
    expect(socialProvider({})).toBeNull();
    expect(socialProvider({ FEATURE_SOCIAL: "1" })).toBeNull();
    expect(socialProvider({ FEATURE_SOCIAL: "1", SOCIAL_PROVIDER: "mock" })?.name).toBe("mock");
    expect(
      socialProvider({
        FEATURE_SOCIAL: "1",
        META_PAGE_ID: "1",
        META_IG_USER_ID: "2",
        META_SYSTEM_USER_TOKEN: "t",
      })?.name,
    ).toBe("meta");
  });
});

describe("meta provider", () => {
  it("posts a photo to the page with the page's own token", async () => {
    const { http, calls } = fakeFetch((c) =>
      c.url === `${G}/PAGE`
        ? { json: { access_token: "PAGETOKEN" } }
        : { json: { id: "photo1", post_id: "PAGE_post1" } },
    );
    const r = await metaProvider(cfg, http, noWait).publishImage("facebook", "https://t/img.jpg", "Teksts");
    expect(r).toEqual({ ok: true, id: "PAGE_post1" });
    expect(calls[1]).toMatchObject({
      method: "POST",
      url: `${G}/PAGE/photos`,
      body: { url: "https://t/img.jpg", message: "Teksts", access_token: "PAGETOKEN" },
    });
  });

  it("publishes to Instagram in two steps, waiting for a video to be ready", async () => {
    let checks = 0;
    const { http, calls } = fakeFetch((c) => {
      if (c.url === `${G}/IG/media`) return { json: { id: "container" } };
      if (c.url === `${G}/container`)
        return { json: { status_code: ++checks < 2 ? "IN_PROGRESS" : "FINISHED" } };
      return { json: { id: "media9" } };
    });
    const p = metaProvider(cfg, http, noWait);
    expect(await p.publishImage("instagram", "https://t/img.jpg", "Teksts")).toEqual({
      ok: true,
      id: "media9",
    });
    expect(await p.publishVideo("instagram", "https://t/v.mp4", "Video")).toEqual({ ok: true, id: "media9" });
    expect(calls.map((c) => c.url.replace(G, ""))).toEqual([
      "/IG/media",
      "/IG/media_publish",
      "/IG/media",
      "/container",
      "/container",
      "/IG/media_publish",
    ]);
    expect(calls[2]!.body).toMatchObject({ media_type: "REELS", video_url: "https://t/v.mp4" });
  });

  it("a carousel: items then one container on Instagram, unpublished photos then one feed post on the page", async () => {
    let n = 0;
    const { http, calls } = fakeFetch((c) => {
      if (c.url === `${G}/PAGE`) return { json: { access_token: "PT" } };
      if (c.url === `${G}/PAGE/feed`) return { json: { id: "PAGE_feed1" } };
      return { json: { id: `id${++n}` } };
    });
    const p = metaProvider(cfg, http, noWait);
    expect(await p.publishCarousel("instagram", ["u1", "u2"], "Teksts")).toMatchObject({ ok: true });
    const ig = calls.filter((c) => c.url.startsWith(`${G}/IG`));
    expect(ig.map((c) => c.body.is_carousel_item ?? c.body.media_type ?? "publish")).toEqual([
      "true",
      "true",
      "CAROUSEL",
      "publish",
    ]);
    expect(ig[2]!.body).toMatchObject({ children: "id1,id2", caption: "Teksts" });
    expect(await p.publishCarousel("facebook", ["u1", "u2"], "Teksts")).toEqual({
      ok: true,
      id: "PAGE_feed1",
    });
    const photos = calls.filter((c) => c.url === `${G}/PAGE/photos`);
    expect(photos.map((c) => c.body.published)).toEqual(["false", "false"]);
    const feed = calls.find((c) => c.url === `${G}/PAGE/feed`)!;
    expect(feed.body.message).toBe("Teksts");
    expect(JSON.parse(feed.body["attached_media[1]"]!)).toEqual({ media_fbid: "id6" });
  });

  it("returns Meta's error as text, and a failed video stops waiting", async () => {
    const { http } = fakeFetch((c) =>
      c.url === `${G}/IG/media`
        ? { status: 400, json: { error: { message: "Invalid image", code: 9004 } } }
        : { json: {} },
    );
    expect(await metaProvider(cfg, http, noWait).publishImage("instagram", "x", "y")).toEqual({
      ok: false,
      error: "Meta 400 #9004: Invalid image",
    });
    const bad = fakeFetch((c) =>
      c.url === `${G}/IG/media` ? { json: { id: "c" } } : { json: { status_code: "ERROR" } },
    );
    expect(await metaProvider(cfg, bad.http, noWait).publishVideo("instagram", "v", "y")).toEqual({
      ok: false,
      error: "Instagram video ERROR",
    });
  });

  it("posts a video to the page and deletes posts on both networks", async () => {
    const { http, calls } = fakeFetch((c) =>
      c.url === `${G}/PAGE` ? { json: { access_token: "PT" } } : { json: { id: "v1", success: true } },
    );
    const p = metaProvider(cfg, http, noWait);
    expect(await p.publishVideo("facebook", "https://t/v.mp4", "Video")).toEqual({ ok: true, id: "v1" });
    expect(calls.at(-1)).toMatchObject({
      url: `${G}/PAGE/videos`,
      body: { file_url: "https://t/v.mp4", description: "Video" },
    });
    expect(await p.remove("facebook", "PAGE_post1")).toBe(true);
    expect(await p.remove("instagram", "media9")).toBe(true);
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.body.access_token)).toEqual(["PT", "SYS"]);
  });

  it("reads reach and reactions; page insights are optional", async () => {
    const { http } = fakeFetch((c) => {
      if (c.url === `${G}/PAGE`) return { json: { access_token: "PT" } };
      if (c.url === `${G}/post1`)
        return {
          json: {
            reactions: { summary: { total_count: 7 } },
            comments: { summary: { total_count: 2 } },
            shares: { count: 1 },
          },
        };
      if (c.url === `${G}/post1/insights`)
        return { status: 400, json: { error: { message: "not enough followers" } } };
      if (c.url === `${G}/media9/insights`)
        return {
          json: {
            data: [
              { name: "reach", values: [{ value: 120 }] },
              { name: "likes", total_value: { value: 9 } },
              { name: "comments", values: [{ value: 1 }] },
              { name: "shares", values: [{ value: 0 }] },
            ],
          },
        };
      return { status: 500, json: {} };
    });
    const p = metaProvider(cfg, http, noWait);
    expect(await p.insights("facebook", "post1")).toEqual({
      reach: 0,
      reactions: 7,
      comments: 2,
      shares: 1,
      linkClicks: 0,
    });
    expect(await p.insights("instagram", "media9")).toEqual({
      reach: 120,
      reactions: 9,
      comments: 1,
      shares: 0,
      linkClicks: 0,
    });
    expect(await p.insights("instagram", "gone")).toBeNull();
  });

  it("knows when the token stopped working", async () => {
    expect(await metaProvider(cfg, fakeFetch(() => ({ json: { id: "me" } })).http, noWait).tokenOk()).toBe(
      true,
    );
    expect(
      await metaProvider(
        cfg,
        fakeFetch(() => ({ status: 401, json: { error: { message: "expired" } } })).http,
        noWait,
      ).tokenOk(),
    ).toBe(false);
  });
});
