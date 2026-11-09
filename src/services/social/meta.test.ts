import { describe, expect, it, vi } from "vitest";
import { metaConfigFromEnv, metaProvider, NO_PICTURE } from "./meta";
import { socialProvider } from "./index";

// The Graph API client against a fake fetch: the right endpoints, the page
// token, Instagram's container-then-publish, and errors as text.

type Call = { method: string; url: string; body: Record<string, string> };

/** A picture address in these tests: fetched pictures answer with 2 KB of JPEG unless a test says otherwise. */
const isPicture = (url: string) => /\.jpg$|^https:\/\/img\//.test(url);

function fakeFetch(
  answers: (c: Call) => { status?: number; json: unknown; picture?: "tiny" | "missing" } | null,
) {
  const calls: Call[] = [];
  const http = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = Object.fromEntries(
      method === "GET" ? new URL(url).searchParams : new URLSearchParams(String(init?.body ?? "")),
    );
    const c = { method, url: url.split("?")[0]!, body };
    calls.push(c);
    const a = answers(c);
    if (isPicture(c.url)) {
      if (a?.picture === "missing") return new Response("Not found", { status: 404 });
      const size = a?.picture === "tiny" ? 43 : 2048;
      return new Response(new Uint8Array(size), { status: 200, headers: { "content-type": "image/jpeg" } });
    }
    return new Response(JSON.stringify(a?.json ?? {}), { status: a?.status ?? 200 });
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

  it("publishes to Instagram in two steps, waiting until the media is ready", async () => {
    let checks = 0;
    const { http, calls } = fakeFetch((c) => {
      if (c.url === `${G}/IG/media`) return { json: { id: "container" } };
      if (c.url === `${G}/container`)
        return { json: { status_code: ++checks % 2 ? "IN_PROGRESS" : "FINISHED" } };
      return { json: { id: "media9" } };
    });
    const p = metaProvider(cfg, http, noWait);
    expect(await p.publishImage("instagram", "https://t/img.jpg", "Teksts")).toEqual({
      ok: true,
      id: "media9",
    });
    expect(await p.publishVideo("instagram", "https://t/v.mp4", "Video")).toEqual({ ok: true, id: "media9" });
    // An image waits too: publishing before "FINISHED" is Meta's #9007.
    expect(calls.map((c) => c.url.replace(G, ""))).toEqual([
      "/IG/media",
      "/container",
      "/container",
      "/IG/media_publish",
      "/IG/media",
      "/container",
      "/container",
      "/IG/media_publish",
    ]);
    expect(calls[4]!.body).toMatchObject({ media_type: "REELS", video_url: "https://t/v.mp4" });
  });

  it("tries publishing again when Meta says the media id is not available yet, and gives up after three", async () => {
    let publishes = 0;
    const { http } = fakeFetch((c) => {
      if (c.url === `${G}/IG/media_publish`)
        return ++publishes < 2
          ? { status: 400, json: { error: { message: "Media ID is not available", code: 9007 } } }
          : { json: { id: "m2" } };
      return { json: { id: "c", status_code: "FINISHED" } };
    });
    expect(await metaProvider(cfg, http, noWait).publishImage("instagram", "u", "t")).toEqual({
      ok: true,
      id: "m2",
    });
    expect(publishes).toBe(2);
    const never = fakeFetch((c) =>
      c.url === `${G}/IG/media_publish`
        ? { status: 400, json: { error: { message: "Media ID is not available", code: 9007 } } }
        : { json: { id: "c", status_code: "FINISHED" } },
    );
    expect(await metaProvider(cfg, never.http, noWait).publishImage("instagram", "u", "t")).toEqual({
      ok: false,
      error: "Meta 400 #9007: Media ID is not available",
    });
    expect(never.calls.filter((c) => c.url === `${G}/IG/media_publish`)).toHaveLength(3);
  });

  it("a carousel: items then one container on Instagram, unpublished photos then one feed post on the page", async () => {
    let n = 0;
    const { http, calls } = fakeFetch((c) => {
      if (c.url === `${G}/PAGE`) return { json: { access_token: "PT" } };
      if (c.url === `${G}/PAGE/feed`) return { json: { id: "PAGE_feed1" } };
      if (c.method === "GET") return { json: { status_code: "FINISHED" } };
      return { json: { id: `id${++n}` } };
    });
    const p = metaProvider(cfg, http, noWait);
    const imgs = [
      { url: "u1", alt: "Trauku mazgājamās mašīnas, cena" },
      { url: "u2", alt: "Bosch SMV2ITX22E, 529,99 €" },
    ];
    expect(await p.publishCarousel("instagram", imgs, "Teksts")).toMatchObject({ ok: true });
    const ig = calls.filter((c) => c.url.startsWith(`${G}/IG`) && c.method === "POST");
    expect(ig.map((c) => c.body.is_carousel_item ?? c.body.media_type ?? "publish")).toEqual([
      "true",
      "true",
      "CAROUSEL",
      "publish",
    ]);
    expect(ig[2]!.body).toMatchObject({ children: "id1,id2", caption: "Teksts" });
    // Every slide carries its own alt text on Instagram.
    expect(ig.slice(0, 2).map((c) => c.body.alt_text)).toEqual([imgs[0]!.alt, imgs[1]!.alt]);
    expect(await p.publishCarousel("facebook", imgs, "Teksts")).toEqual({
      ok: true,
      id: "PAGE_feed1",
    });
    const photos = calls.filter((c) => c.url === `${G}/PAGE/photos`);
    expect(photos.map((c) => c.body.published)).toEqual(["false", "false"]);
    const feed = calls.find((c) => c.url === `${G}/PAGE/feed`)!;
    expect(feed.body.message).toBe("Teksts");
    expect(JSON.parse(feed.body["attached_media[1]"]!)).toEqual({ media_fbid: "id6" });
  });

  const cardImgs = [1, 2].map((n) => ({
    url: `https://t/${n}/image.jpg`,
    card: {
      link: `https://t/social/p/${n}`,
      name: `Karte ${n}`,
      description: "no 23 €",
      picture: `https://t/${n}/square.jpg`,
    },
  }));

  const own = (c: Call, owned: boolean) =>
    c.url === `${G}/` && c.method === "GET" && c.body.fields?.startsWith("ownership_permissions")
      ? { json: { id: c.body.id, ownership_permissions: { can_customize_link_posts: owned } } }
      : null;

  it("without an ad account: the carousel that ran before (card pictures on the site) when the Page owns the domain, photos when not", async () => {
    const notOwned = fakeFetch((c) => {
      if (c.url === `${G}/PAGE`) return { json: { access_token: "PT" } };
      return own(c, false) ?? { json: { id: c.url === `${G}/PAGE/feed` ? "PAGE_ph" : "p1" } };
    });
    expect(
      await metaProvider(cfg, notOwned.http, noWait).publishCarousel(
        "facebook",
        cardImgs,
        "Teksts 👉 L",
        "L",
      ),
    ).toEqual({ ok: true, id: "PAGE_ph" });
    expect(notOwned.calls.some((c) => c.body.child_attachments)).toBe(false);
    expect(notOwned.calls.filter((c) => c.url === `${G}/PAGE/photos`)).toHaveLength(2);

    const owned = fakeFetch((c) => {
      if (c.url === `${G}/PAGE`) return { json: { access_token: "PT" } };
      const o = own(c, true);
      if (o) return o;
      // The read-back hits Meta's rate limit (as at 19:00 on 9 Nov): it cannot be read now.
      if (c.method === "GET" && c.url === `${G}/PAGE_lc`)
        return { status: 403, json: { error: { message: "Application request limit reached", code: 4 } } };
      return { json: { id: "PAGE_lc" } };
    });
    expect(
      await metaProvider(cfg, owned.http, noWait).publishCarousel(
        "facebook",
        cardImgs,
        "Teksts",
        "https://t/post",
      ),
    ).toEqual({ ok: true, id: "PAGE_lc" });
    const feed = owned.calls.find((c) => c.url === `${G}/PAGE/feed`)!;
    expect(JSON.parse(feed.body.child_attachments!).map((c: { picture: string }) => c.picture)).toEqual([
      "https://t/1/square.jpg",
      "https://t/2/square.jpg",
    ]);
    // Kept (it may be fine); the next ticks look at it again (checkRecentCarousels).
    expect(owned.calls.filter((c) => c.method === "DELETE")).toHaveLength(0);
  });

  it("with an ad account: each card picture is uploaded and named by hash in one clickable carousel; Facebook fetches nothing", async () => {
    const withAds = { ...cfg, adAccountId: "77" };
    let n = 0;
    const { http, calls } = fakeFetch((c) => {
      if (c.url === `${G}/PAGE`) return { json: { access_token: "PT" } };
      if (c.url === `${G}/act_77/adimages`) return { json: { images: { bytes: { hash: `h${++n}` } } } };
      return { json: { id: "PAGE_lc" } };
    });
    expect(
      await metaProvider(withAds, http, noWait).publishCarousel(
        "facebook",
        cardImgs,
        "Teksts",
        "https://t/post",
      ),
    ).toEqual({ ok: true, id: "PAGE_lc" });
    // Each square picture fetched from the site and uploaded as bytes, with the system token.
    const uploads = calls.filter((c) => c.url === `${G}/act_77/adimages`);
    expect(uploads).toHaveLength(2);
    expect(uploads[0]!.body.bytes).toBe(Buffer.from(new Uint8Array(2048)).toString("base64"));
    expect(uploads[0]!.body.access_token).toBe("SYS");
    const feed = calls.find((c) => c.url === `${G}/PAGE/feed`)!;
    expect(feed.body).toMatchObject({ message: "Teksts", link: "https://t/post", access_token: "PT" });
    expect(JSON.parse(feed.body.child_attachments!)).toEqual(
      [1, 2].map((k) => ({
        link: `https://t/social/p/${k}`,
        name: `Karte ${k}`,
        description: "no 23 €",
        image_hash: `h${k}`,
      })),
    );
    // No ownership check, no picture address for Facebook to fetch, no photos, no read-back.
    expect(calls.some((c) => c.body.fields?.startsWith("ownership_permissions"))).toBe(false);
    expect(feed.body.child_attachments).not.toContain("square.jpg");
    expect(calls.filter((c) => c.url === `${G}/PAGE/photos`)).toHaveLength(0);
    expect(calls.filter((c) => c.method === "GET" && c.url.startsWith(`${G}/PAGE_lc`))).toHaveLength(0);
  });

  it("with an ad account, a failed upload or a refused carousel still posts the photos; a token error stops", async () => {
    const withAds = { ...cfg, adAccountId: "77" };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const noPerm = fakeFetch((c) => {
        if (c.url === `${G}/PAGE`) return { json: { access_token: "PT" } };
        if (c.url === `${G}/act_77/adimages`)
          return { status: 403, json: { error: { message: "Missing ads_management", code: 294 } } };
        return { json: { id: "PAGE_ph" } };
      });
      expect(
        await metaProvider(withAds, noPerm.http, noWait).publishCarousel("facebook", cardImgs, "T", "L"),
      ).toEqual({
        ok: true,
        id: "PAGE_ph",
      });
      expect(noPerm.calls.filter((c) => c.url === `${G}/PAGE/photos`)).toHaveLength(2);
      const refused = fakeFetch((c) => {
        if (c.url === `${G}/PAGE`) return { json: { access_token: "PT" } };
        if (c.url === `${G}/act_77/adimages`) return { json: { images: { bytes: { hash: "h" } } } };
        if (c.url === `${G}/PAGE/feed` && c.body.child_attachments)
          return { status: 400, json: { error: { message: "Invalid parameter", code: 100 } } };
        return { json: { id: "PAGE_ph2" } };
      });
      expect(
        await metaProvider(withAds, refused.http, noWait).publishCarousel("facebook", cardImgs, "T", "L"),
      ).toEqual({
        ok: true,
        id: "PAGE_ph2",
      });
    } finally {
      warn.mockRestore();
    }
    const expired = fakeFetch((c) =>
      c.url === `${G}/PAGE`
        ? { json: { access_token: "PT" } }
        : { status: 401, json: { error: { message: "Session has expired", code: 190 } } },
    );
    expect(
      await metaProvider(withAds, expired.http, noWait).publishCarousel("facebook", cardImgs, "T", "L"),
    ).toEqual({
      ok: false,
      error: "Meta 401 #190: Session has expired",
    });
    expect(expired.calls.filter((c) => c.url === `${G}/PAGE/photos`)).toHaveLength(0);
  });

  it("reads the ad account from the environment, with or without act_", () => {
    const base = { META_PAGE_ID: "P", META_IG_USER_ID: "I", META_SYSTEM_USER_TOKEN: "T" };
    expect(metaConfigFromEnv({ ...base, META_AD_ACCOUNT_ID: "act_123" })?.adAccountId).toBe("123");
    expect(metaConfigFromEnv({ ...base, META_AD_ACCOUNT_ID: "123" })?.adAccountId).toBe("123");
    expect(metaConfigFromEnv(base)?.adAccountId).toBeUndefined();
  });

  it("an Instagram carousel reads each item's status a few times at most, not every five seconds", async () => {
    let reads = 0;
    const { http, calls } = fakeFetch((c) => {
      if (c.method === "GET" && c.url.startsWith(`${G}/item`)) {
        reads++;
        // Not ready on the first read, ready after.
        return { json: { status_code: reads === 1 ? "IN_PROGRESS" : "FINISHED" } };
      }
      if (c.method === "GET") return { json: { status_code: "FINISHED" } };
      if (c.url === `${G}/IG/media` && c.body.is_carousel_item)
        return { json: { id: `item${calls.length}` } };
      return { json: { id: "x" } };
    });
    const imgs = [1, 2, 3, 4, 5].map((n) => ({ url: `https://t/${n}/image.jpg` }));
    expect(await metaProvider(cfg, http, noWait).publishCarousel("instagram", imgs, "T")).toMatchObject({
      ok: true,
    });
    // Five items made first, then read: once each (one of them twice), not twelve times each.
    expect(reads).toBeLessThanOrEqual(6);
    const posts = calls
      .filter((c) => c.method === "POST")
      .map((c) => c.body.is_carousel_item ?? c.body.media_type ?? "publish");
    expect(posts).toEqual(["true", "true", "true", "true", "true", "CAROUSEL", "publish"]);
  });

  it("finds an Instagram post by its caption, for a publish that failed on our side", async () => {
    const since = new Date("2026-11-09T16:00:00Z");
    const { http } = fakeFetch((c) =>
      c.url === `${G}/IG/media`
        ? {
            json: {
              data: [
                { id: "old", caption: "Teksts", timestamp: "2026-11-08T10:00:00+0000" },
                { id: "m7", caption: "Teksts\n", timestamp: "2026-11-09T17:30:00+0000" },
              ],
            },
          }
        : null,
    );
    const p = metaProvider(cfg, http, noWait);
    expect(await p.findInstagram("Teksts", since)).toEqual({ id: "m7" });
    expect(await p.findInstagram("Cits", since)).toEqual({ id: null });
    const down = fakeFetch(() => ({ status: 403, json: { error: { message: "limit", code: 4 } } }));
    expect(await metaProvider(cfg, down.http, noWait).findInstagram("Teksts", since)).toBeNull();
  });

  it("a link post drawn without its picture is removed and reported, so the caller posts a photo", async () => {
    const { http, calls } = fakeFetch((c) => {
      if (c.url === `${G}/PAGE`) return { json: { access_token: "PT" } };
      if (c.url === `${G}/PAGE_l9`) return { json: { attachments: { data: [{ type: "share" }] } } };
      return { json: { id: "PAGE_l9" } };
    });
    expect(await metaProvider(cfg, http, noWait).publishLink("https://t/x", "T", "https://t/p.jpg")).toEqual({
      ok: false,
      error: NO_PICTURE,
    });
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual([`${G}/PAGE_l9`]);
  });

  it("a link post on the page: message and link, with the page's token", async () => {
    const { http, calls } = fakeFetch((c) =>
      c.url === `${G}/PAGE` ? { json: { access_token: "PT" } } : { json: { id: "PAGE_l1" } },
    );
    expect(await metaProvider(cfg, http, noWait).publishLink("https://t/x", "Teksts")).toEqual({
      ok: true,
      id: "PAGE_l1",
    });
    expect(calls.find((c) => c.url === `${G}/PAGE/feed`)).toMatchObject({
      body: { message: "Teksts", link: "https://t/x", access_token: "PT" },
    });
    const bad = fakeFetch(() => ({ status: 400, json: { error: { message: "Bad link", code: 100 } } }));
    expect(await metaProvider(cfg, bad.http, noWait).publishLink("x", "y")).toMatchObject({ ok: false });
  });

  it("refreshes a link's preview (page and picture drawn first) and reads whether a post's preview has its picture", async () => {
    const { http, calls } = fakeFetch((c) =>
      c.url === `${G}/PAGE`
        ? { json: { access_token: "PT" } }
        : c.url === `${G}/PAGE_1`
          ? {
              json: {
                attachments: { data: [{ type: "share", media: { image: { src: "https://x/p.jpg" } } }] },
              },
            }
          : c.url === `${G}/PAGE_2`
            ? { json: { attachments: { data: [{ type: "share" }] } } }
            : c.url === `${G}/PAGE_3`
              ? { json: {} }
              : { json: { id: "https://t/x" } },
    );
    const p = metaProvider(cfg, http, noWait);
    expect(await p.refreshLink("https://t/x", "https://t/social/1/link.jpg")).toBe(true);
    const urls = calls.map((c) => c.url);
    const scrape = calls.findIndex(
      (c) => c.url === `${G}/` && c.body.scrape === "true" && c.body.id === "https://t/x",
    );
    expect(urls.indexOf("https://t/x")).toBeLessThan(scrape);
    expect(urls.indexOf("https://t/social/1/link.jpg")).toBeLessThan(scrape);
    expect(await p.linkPreview("PAGE_1")).toEqual({ image: true });
    expect(await p.linkPreview("PAGE_2")).toEqual({ image: false });
    expect(await p.linkPreview("PAGE_3")).toBeNull();
    // A link carousel: every card needs its picture.
    const cards = (srcs: (string | null)[]) =>
      fakeFetch((c) =>
        c.url === `${G}/PAGE`
          ? { json: { access_token: "PT" } }
          : {
              json: {
                attachments: {
                  data: [
                    {
                      type: "multi_share",
                      subattachments: { data: srcs.map((s) => (s ? { media: { image: { src: s } } } : {})) },
                    },
                  ],
                },
              },
            },
      );
    expect(
      await metaProvider(cfg, cards(["https://img/a", "https://img/b"]).http, noWait).linkPreview("C"),
    ).toEqual({ image: true });
    // Facebook names an address for every card, but the picture behind the first never loaded.
    const grey = fakeFetch((c) =>
      c.url === `${G}/PAGE`
        ? { json: { access_token: "PT" } }
        : c.url === "https://img/grey"
          ? { json: null, picture: "missing" }
          : c.url === "https://img/tiny"
            ? { json: null, picture: "tiny" }
            : {
                json: {
                  attachments: {
                    data: [
                      {
                        type: "multi_share",
                        subattachments: {
                          data: ["https://img/grey", "https://img/tiny", "https://img/ok"].map((src) => ({
                            media: { image: { src } },
                          })),
                        },
                      },
                    ],
                  },
                },
              },
    );
    expect(await metaProvider(cfg, grey.http, noWait).linkPreview("C")).toEqual({
      image: false,
      missing: [1, 2],
    });
    expect(await metaProvider(cfg, cards(["https://img/a", null]).http, noWait).linkPreview("C")).toEqual({
      image: false,
      missing: [2],
    });
    const down = fakeFetch(() => ({ status: 500, json: { error: { message: "down", code: 2 } } }));
    expect(await metaProvider(cfg, down.http, noWait).refreshLink("https://t/x")).toBe(false);
    expect(await metaProvider(cfg, down.http, noWait).linkPreview("PAGE_1")).toBeNull();
  });

  it("a link post first draws its picture and has Facebook read the link, so the preview has the picture", async () => {
    const { http, calls } = fakeFetch((c) =>
      c.url === `${G}/PAGE` ? { json: { access_token: "PT" } } : { json: { id: "PAGE_l2" } },
    );
    const r = await metaProvider(cfg, http, noWait).publishLink(
      "https://t/x",
      "Teksts",
      "https://t/link.jpg",
    );
    expect(r).toEqual({ ok: true, id: "PAGE_l2" });
    const urls = calls.map((c) => c.url);
    const pic = urls.indexOf("https://t/link.jpg");
    const scrape = calls.findIndex(
      (c) => c.url === `${G}/` && c.body.scrape === "true" && c.body.id === "https://t/x",
    );
    const feed = urls.indexOf(`${G}/PAGE/feed`);
    expect(pic).toBeGreaterThanOrEqual(0);
    expect(pic).toBeLessThan(scrape);
    expect(scrape).toBeLessThan(feed);
    // A refused scrape does not stop the post.
    const noScrape = fakeFetch((c) =>
      c.url === `${G}/`
        ? { status: 400, json: { error: { message: "x", code: 100 } } }
        : c.url === `${G}/PAGE`
          ? { json: { access_token: "PT" } }
          : { json: { id: "PAGE_l3" } },
    );
    expect(await metaProvider(cfg, noScrape.http, noWait).publishLink("https://t/x", "T")).toEqual({
      ok: true,
      id: "PAGE_l3",
    });
  });

  it("an image goes out without alt text when Meta refuses the field", async () => {
    let refused = 0;
    const { http, calls } = fakeFetch((c) => {
      if (c.url === `${G}/IG/media` && c.body.alt_text) {
        refused++;
        return { status: 400, json: { error: { message: "(#100) Param alt_text is not supported" } } };
      }
      return { json: { id: "m1", status_code: "FINISHED" } };
    });
    expect(await metaProvider(cfg, http, noWait).publishImage("instagram", "u", "Teksts", "Alt")).toEqual({
      ok: true,
      id: "m1",
    });
    expect(refused).toBe(1);
    expect(calls.filter((c) => c.url === `${G}/IG/media`).map((c) => c.body.alt_text ?? null)).toEqual([
      "Alt",
      null,
    ]);
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
    expect(await metaProvider(cfg, bad.http, noWait).publishImage("instagram", "i", "y")).toEqual({
      ok: false,
      error: "Instagram media ERROR",
    });
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
