import { describe, expect, it } from "vitest";
import { metaConfigFromEnv, metaProvider, NO_PICTURE } from "./meta";
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

  it("tries publishing again when Meta says the media id is not available yet, and gives up after five", async () => {
    let publishes = 0;
    const { http } = fakeFetch((c) => {
      if (c.url === `${G}/IG/media_publish`)
        return ++publishes < 3
          ? { status: 400, json: { error: { message: "Media ID is not available", code: 9007 } } }
          : { json: { id: "m2" } };
      return { json: { id: "c", status_code: "FINISHED" } };
    });
    expect(await metaProvider(cfg, http, noWait).publishImage("instagram", "u", "t")).toEqual({
      ok: true,
      id: "m2",
    });
    expect(publishes).toBe(3);
    const never = fakeFetch((c) =>
      c.url === `${G}/IG/media_publish`
        ? { status: 400, json: { error: { message: "Media ID is not available", code: 9007 } } }
        : { json: { id: "c", status_code: "FINISHED" } },
    );
    expect(await metaProvider(cfg, never.http, noWait).publishImage("instagram", "u", "t")).toEqual({
      ok: false,
      error: "Meta 400 #9007: Media ID is not available",
    });
    expect(never.calls.filter((c) => c.url === `${G}/IG/media_publish`)).toHaveLength(5);
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

  // Meta (Page feed reference): a link's picture, name and line can be customised only when
  // the Page owns the link, read from ownership_permissions{can_customize_link_posts}.
  const own = (c: Call, owned: boolean) =>
    c.url === `${G}/` && c.method === "GET" && c.body.fields?.startsWith("ownership_permissions")
      ? { json: { id: c.body.id, ownership_permissions: { can_customize_link_posts: owned } } }
      : null;
  const cardImgs = [1, 2].map((n) => ({
    url: `https://t/${n}/image.jpg`,
    card: {
      link: `https://t/social/p/${n}`,
      name: `Karte ${n}`,
      description: "no 23 €",
      picture: `https://t/${n}/square.jpg`,
    },
  }));

  it("a carousel is a link carousel only when the Page owns the domain; otherwise photos, with no crawl involved", async () => {
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
    // The check came first, then the slides as unpublished photos and one feed post with all of them.
    const check = notOwned.calls.findIndex((c) => c.body.fields?.startsWith("ownership_permissions"));
    expect(notOwned.calls[check]!.body.id).toBe("https://t/social/p/1");
    const photos = notOwned.calls.filter((c) => c.url === `${G}/PAGE/photos`);
    expect(photos.map((c) => [c.body.url, c.body.published])).toEqual([
      ["https://t/1/image.jpg", "false"],
      ["https://t/2/image.jpg", "false"],
    ]);
    const feed = notOwned.calls.find((c) => c.url === `${G}/PAGE/feed`)!;
    expect(feed.body.child_attachments).toBeUndefined();
    expect(feed.body.message).toBe("Teksts 👉 L");
    expect(Object.keys(feed.body).filter((k) => k.startsWith("attached_media"))).toHaveLength(2);
    // The check failing counts as not owned.
    const down = fakeFetch((c) => {
      if (c.url === `${G}/PAGE`) return { json: { access_token: "PT" } };
      if (c.body.fields?.startsWith("ownership_permissions"))
        return { status: 500, json: { error: { message: "x", code: 2 } } };
      return { json: { id: "p2" } };
    });
    await metaProvider(cfg, down.http, noWait).publishCarousel("facebook", cardImgs, "T", "L");
    expect(down.calls.some((c) => c.body.child_attachments)).toBe(false);
  });

  it("owned: card pictures uploaded to Facebook first, one feed post whose cards name Facebook's copy", async () => {
    const cdn = (n: number) => `https://scontent.xx.fbcdn.net/v/${n}.jpg`;
    const { http, calls } = fakeFetch((c) => {
      if (c.url === `${G}/PAGE`) return { json: { access_token: "PT" } };
      const o = own(c, true);
      if (o) return o;
      if (c.url === `${G}/PAGE/photos`)
        return { json: { id: `ph${/\/(\d)\/square/.exec(c.body.url!)![1]}` } };
      const ph = /\/ph(\d)$/.exec(c.url);
      if (ph)
        return {
          json: {
            images: [
              { source: "small", width: 130 },
              { source: cdn(Number(ph[1])), width: 1080 },
            ],
          },
        };
      if (c.url === `${G}/PAGE_lc1`)
        return {
          json: {
            attachments: {
              data: [
                {
                  type: "multi_share",
                  subattachments: { data: [1, 2].map((n) => ({ media: { image: { src: cdn(n) } } })) },
                },
              ],
            },
          },
        };
      return { json: { id: "PAGE_lc1" } };
    });
    expect(
      await metaProvider(cfg, http, noWait).publishCarousel("facebook", cardImgs, "Teksts", "https://t/post"),
    ).toEqual({ ok: true, id: "PAGE_lc1" });
    const uploads = calls.filter((c) => c.url === `${G}/PAGE/photos`);
    expect(uploads.map((c) => [c.body.url, c.body.published])).toEqual([
      ["https://t/1/square.jpg", "false"],
      ["https://t/2/square.jpg", "false"],
    ]);
    const feed = calls.find((c) => c.url === `${G}/PAGE/feed`)!;
    expect(feed.body).toMatchObject({
      message: "Teksts",
      link: "https://t/post",
      multi_share_optimized: "false",
      multi_share_end_card: "false",
    });
    // Each card keeps its own link (no ?p=) and names Facebook's copy as its picture.
    expect(JSON.parse(feed.body.child_attachments!)).toEqual(
      [1, 2].map((n) => ({
        link: `https://t/social/p/${n}`,
        name: `Karte ${n}`,
        description: "no 23 €",
        picture: cdn(n),
      })),
    );
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(0);
  });

  it("owned: a picture Facebook could not take keeps its own address; a carousel drawn without pictures is replaced by photos", async () => {
    const reads = [[], []] as string[][];
    const { http, calls } = fakeFetch((c) => {
      if (c.url === `${G}/PAGE`) return { json: { access_token: "PT" } };
      const o = own(c, true);
      if (o) return o;
      if (c.url === `${G}/PAGE/photos` && c.body.url?.endsWith("square.jpg"))
        return { status: 400, json: { error: { message: "bad image", code: 324 } } };
      if (c.url === `${G}/PAGE_lc2`) {
        const srcs = reads.shift() ?? [];
        return {
          json: {
            attachments: {
              data: [
                {
                  type: "multi_share",
                  subattachments: {
                    data: [0, 1].map((k) => (srcs[k] ? { media: { image: { src: srcs[k] } } } : {})),
                  },
                },
              ],
            },
          },
        };
      }
      if (c.url === `${G}/PAGE/feed` && c.body.child_attachments) return { json: { id: "PAGE_lc2" } };
      return { json: { id: "p9" } };
    });
    expect(await metaProvider(cfg, http, noWait).publishCarousel("facebook", cardImgs, "T", "L")).toEqual({
      ok: true,
      id: "p9",
    });
    const feed = calls.find((c) => c.url === `${G}/PAGE/feed` && c.body.child_attachments)!;
    expect(JSON.parse(feed.body.child_attachments!).map((x: { picture: string }) => x.picture)).toEqual([
      "https://t/1/square.jpg",
      "https://t/2/square.jpg",
    ]);
    // Read twice without pictures: removed, and the slides posted as photos.
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual([`${G}/PAGE_lc2`]);
    expect(
      calls.filter((c) => c.url === `${G}/PAGE/photos` && c.body.url?.endsWith("image.jpg")),
    ).toHaveLength(2);
  });

  it("reads whether the Page owns a domain, for the admin", async () => {
    const yes = fakeFetch((c) =>
      c.url === `${G}/PAGE` ? { json: { access_token: "PT" } } : (own(c, true) ?? { json: {} }),
    );
    expect(await metaProvider(cfg, yes.http, noWait).linkOwnership("https://t/")).toBe(true);
    const no = fakeFetch((c) =>
      c.url === `${G}/PAGE` ? { json: { access_token: "PT" } } : (own(c, false) ?? { json: {} }),
    );
    expect(await metaProvider(cfg, no.http, noWait).linkOwnership("https://t/")).toBe(false);
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

  it("when Meta refuses the link carousel the slides still go out as photos; a token error does not retry", async () => {
    const refused = fakeFetch((c) => {
      if (c.url === `${G}/PAGE`) return { json: { access_token: "PT" } };
      const o = own(c, true);
      if (o) return o;
      if (c.url === `${G}/PAGE/feed` && c.body.child_attachments)
        return { status: 400, json: { error: { message: "Invalid parameter", code: 100 } } };
      return { json: { id: "p1" } };
    });
    const imgs = [1, 2].map((n) => ({
      url: `u${n}`,
      card: { link: `l${n}`, name: "K", picture: `s${n}` },
    }));
    expect(await metaProvider(cfg, refused.http, noWait).publishCarousel("facebook", imgs, "T", "L")).toEqual(
      {
        ok: true,
        id: "p1",
      },
    );
    expect(
      refused.calls.filter((c) => c.url === `${G}/PAGE/photos` && c.body.url?.startsWith("u")),
    ).toHaveLength(2);
    const expired = fakeFetch((c) =>
      c.url === `${G}/PAGE`
        ? { json: { access_token: "PT" } }
        : { status: 401, json: { error: { message: "Session has expired", code: 190 } } },
    );
    expect(await metaProvider(cfg, expired.http, noWait).publishCarousel("facebook", imgs, "T", "L")).toEqual(
      {
        ok: false,
        error: "Meta 401 #190: Session has expired",
      },
    );
    // A token error stops the post at the ownership check: nothing is uploaded.
    expect(expired.calls.filter((c) => c.url === `${G}/PAGE/photos`)).toHaveLength(0);
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
    expect(await metaProvider(cfg, cards(["a", "b"]).http, noWait).linkPreview("C")).toEqual({ image: true });
    expect(await metaProvider(cfg, cards(["a", null]).http, noWait).linkPreview("C")).toEqual({
      image: false,
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
