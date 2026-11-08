import type { CarouselImage, Insight, Network, PublishResult, SocialProvider } from "./provider";

// Meta's Graph API for the Trilio page and its Instagram business account
// (docs/SOCIAL_PLAN.md §7–8). One system-user token from Business Manager;
// the page's own token is read from it once. Errors come back as text for
// the admin queue, never as exceptions.

export type MetaConfig = {
  pageId: string;
  igUserId: string;
  token: string;
  version: string;
};

export function metaConfigFromEnv(env: Record<string, string | undefined> = process.env): MetaConfig | null {
  const pageId = env.META_PAGE_ID?.trim();
  const igUserId = env.META_IG_USER_ID?.trim();
  const token = env.META_SYSTEM_USER_TOKEN?.trim();
  if (!pageId || !igUserId || !token) return null;
  return { pageId, igUserId, token, version: env.META_GRAPH_VERSION?.trim() || "v23.0" };
}

type Fetch = typeof fetch;
type Json = Record<string, unknown>;

/** A link post Facebook drew without its picture: removed, and posted as a photo instead. */
export const NO_PICTURE = "Facebook preview without its picture";

export function metaProvider(
  cfg: MetaConfig,
  http: Fetch = fetch,
  wait = (ms: number) => new Promise((r) => setTimeout(r, ms)),
): SocialProvider {
  const base = `https://graph.facebook.com/${cfg.version}`;
  /** Fetches pages and pictures so they are drawn and cached before Facebook's crawler asks. */
  const warm = async (urls: (string | undefined)[]) => {
    await Promise.all(
      urls.map((url) =>
        url
          ? http(url, { signal: AbortSignal.timeout(30_000) })
              .then((r) => r.arrayBuffer())
              .catch(() => undefined)
          : undefined,
      ),
    );
  };
  let pageToken: string | null = null;

  /**
   * Has Facebook read a link now (its Open Graph tags and picture) and says
   * whether it got a picture: the `image` of the URL object it returns. Null
   * when the scrape itself failed (the post may still go out).
   */
  async function scrape(link: string, token: string): Promise<boolean | null> {
    try {
      const r = await call("POST", "", { id: link, scrape: "true" }, token);
      const image = r.image;
      return Array.isArray(image) && image.length > 0;
    } catch {
      return null;
    }
  }

  /**
   * Whether this Page may customise a link's preview (picture, name, line):
   * `ownership_permissions{can_customize_link_posts}` on the URL node, which Meta
   * says to read before posting new links (docs/FACEBOOK_CAROUSEL_PLAN.md). True
   * only when trilio.lv is verified and assigned to the Page; false otherwise,
   * also when the check itself fails.
   */
  async function canCustomize(url: string, token: string): Promise<boolean> {
    try {
      const r = await call(
        "GET",
        "",
        { id: url, fields: "ownership_permissions{can_customize_link_posts}" },
        token,
      );
      const perms = r.ownership_permissions as { can_customize_link_posts?: boolean } | undefined;
      return perms?.can_customize_link_posts === true;
    } catch (err) {
      // A token or page problem stops the post here; anything else counts as not owned.
      if (err instanceof Error && /#(190|200|10)\b/.test(err.message)) throw err;
      return false;
    }
  }

  /**
   * Facebook's own copy of a picture (docs/SOCIAL_PLAN.md §12, 8 Nov 2026): uploaded
   * to the page unpublished (never shown on the page), then its largest image on
   * Facebook's servers. A card that names this copy needs nothing from trilio.lv
   * when the post is made. Null when the upload or the read fails.
   */
  async function hostPicture(url: string, token: string): Promise<string | null> {
    try {
      const photo = await call("POST", `${cfg.pageId}/photos`, { url, published: "false" }, token);
      const r = await call("GET", String(photo.id), { fields: "images" }, token);
      const images = Array.isArray(r.images) ? (r.images as { source?: string; width?: number }[]) : [];
      const best = images
        .filter((i) => typeof i.source === "string")
        .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
      return best?.source ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Whether a page post just made has its picture (every card's, for a
   * carousel). Facebook attaches pictures as it reads them, so a first "no" is
   * read once more after a moment. Null when it cannot be read.
   */
  async function previewHasPicture(postId: string, read: (id: string) => Promise<{ image: boolean } | null>) {
    const first = await read(postId);
    if (first === null || first.image) return first?.image ?? null;
    await wait(5_000);
    const second = await read(postId);
    return second === null ? false : second.image;
  }

  async function call(
    method: "GET" | "POST" | "DELETE",
    path: string,
    params: Record<string, string>,
    token: string,
  ): Promise<Json> {
    const body = new URLSearchParams({ ...params, access_token: token });
    const url = method === "GET" ? `${base}/${path}?${body}` : `${base}/${path}`;
    const res = await http(url, {
      method,
      headers: method === "GET" ? undefined : { "content-type": "application/x-www-form-urlencoded" },
      body: method === "GET" ? undefined : body,
      signal: AbortSignal.timeout(60_000),
    });
    const json = (await res.json().catch(() => ({}))) as Json;
    if (!res.ok || json.error) {
      const e = (json.error ?? {}) as { message?: string; code?: number };
      throw new Error(`Meta ${res.status}${e.code ? ` #${e.code}` : ""}: ${e.message ?? "request failed"}`);
    }
    return json;
  }

  async function page(): Promise<string> {
    if (pageToken) return pageToken;
    const r = await call("GET", cfg.pageId, { fields: "access_token" }, cfg.token);
    pageToken = typeof r.access_token === "string" ? r.access_token : cfg.token;
    return pageToken;
  }

  const fail = (err: unknown): PublishResult => ({
    ok: false,
    error: err instanceof Error ? err.message : String(err),
  });

  /**
   * Instagram: a container, wait until Meta has fetched the media (an image
   * too: a carousel of five slides takes seconds, and publishing before
   * "FINISHED" fails with #9007 "Media ID is not available"), then publish;
   * a #9007 on publishing is the same wait, tried again.
   */
  async function ready(container: string, video: boolean): Promise<void> {
    for (let i = 0; i < (video ? 30 : 12); i++) {
      const s = await call("GET", container, { fields: "status_code" }, cfg.token);
      if (s.status_code === "FINISHED") return;
      if (s.status_code === "ERROR" || s.status_code === "EXPIRED")
        throw new Error(`Instagram ${video ? "video" : "media"} ${String(s.status_code)}`);
      await wait(5_000);
    }
  }

  async function instagram(params: Record<string, string>, video: boolean): Promise<PublishResult> {
    const created = await call("POST", `${cfg.igUserId}/media`, params, cfg.token);
    const container = String(created.id);
    await ready(container, video);
    for (let attempt = 0; ; attempt++) {
      try {
        const published = await call(
          "POST",
          `${cfg.igUserId}/media_publish`,
          { creation_id: container },
          cfg.token,
        );
        return { ok: true, id: String(published.id) };
      } catch (err) {
        if (attempt >= 4 || !(err instanceof Error && /#9007\b/.test(err.message))) throw err;
        await wait(5_000);
      }
    }
  }

  const num = (v: unknown) => (typeof v === "number" ? v : 0);

  /**
   * Instagram takes alt text with an image (`alt_text`). Should Meta refuse
   * the field for an account or version, the image goes out without it
   * rather than not at all.
   */
  async function withAlt<T>(
    alt: string | undefined,
    run: (a: Record<string, string>) => Promise<T>,
  ): Promise<T> {
    if (!alt) return run({});
    try {
      return await run({ alt_text: alt.slice(0, 1000) });
    } catch (err) {
      if (err instanceof Error && /alt_text/i.test(err.message)) return run({});
      throw err;
    }
  }

  async function linkPreview(postId: string): Promise<{ image: boolean } | null> {
    try {
      type Media = { media?: { image?: { src?: string } }; type?: string };
      const r = (await call(
        "GET",
        postId,
        { fields: "attachments{media,type,subattachments{media,type}}" },
        await page(),
      )) as { attachments?: { data?: (Media & { subattachments?: { data?: Media[] } })[] } };
      const a = r.attachments?.data?.[0];
      if (!a) return null;
      // A link carousel: every card must have its picture.
      const cards = a.subattachments?.data ?? [];
      if (cards.length) return { image: cards.every((c) => !!c.media?.image?.src) };
      return { image: !!a.media?.image?.src };
    } catch {
      return null;
    }
  }

  return {
    name: "meta",
    async publishImage(network: Network, imageUrl: string, caption: string, alt?: string) {
      try {
        if (network === "instagram")
          return await withAlt(alt, (a) => instagram({ image_url: imageUrl, caption, ...a }, false));
        const r = await call(
          "POST",
          `${cfg.pageId}/photos`,
          { url: imageUrl, message: caption },
          await page(),
        );
        return { ok: true, id: String(r.post_id ?? r.id) };
      } catch (err) {
        return fail(err);
      }
    },
    async publishCarousel(network: Network, images: CarouselImage[], caption: string, link?: string) {
      try {
        if (network === "instagram") {
          // Each image is a carousel item first, then one container holds them all.
          const children: string[] = [];
          for (const img of images) {
            const item = await withAlt(img.alt, (a) =>
              call(
                "POST",
                `${cfg.igUserId}/media`,
                { image_url: img.url, is_carousel_item: "true", ...a },
                cfg.token,
              ),
            );
            // Each item must be fetched before the carousel container is made from them.
            await ready(String(item.id), false);
            children.push(String(item.id));
          }
          return await instagram({ media_type: "CAROUSEL", children: children.join(","), caption }, false);
        }
        const token = await page();
        // A link carousel only when this Page owns trilio.lv (domain verified, Page assigned):
        // without that, Facebook ignores each card's picture and draws it from its own crawl
        // of the card's link, which Trilio cannot make reliable (docs/FACEBOOK_CAROUSEL_PLAN.md).
        // Otherwise the slides go out as a multi-photo post below: the pictures always show.
        if (link && images.every((i) => i.card) && (await canCustomize(images[0]!.card!.link, token))) {
          // Each card names Facebook's own copy of its square picture (uploaded unpublished,
          // never shown on the page), so nothing is fetched from trilio.lv when the post is made.
          await warm(images.map((i) => i.card!.picture));
          const hosted = await Promise.all(images.map((i) => hostPicture(i.card!.picture, token)));
          const cards = images.map(({ card }, k) => ({ ...card!, picture: hosted[k] ?? card!.picture }));
          let posted: string | null = null;
          try {
            const r = await call(
              "POST",
              `${cfg.pageId}/feed`,
              {
                message: caption,
                link,
                child_attachments: JSON.stringify(
                  cards.map((card) => ({
                    link: card.link,
                    name: card.name,
                    ...(card.description ? { description: card.description } : {}),
                    picture: card.picture,
                  })),
                ),
                multi_share_optimized: "false",
                multi_share_end_card: "false",
              },
              token,
            );
            posted = String(r.id);
          } catch (err) {
            // A token or page problem fails the same way below; anything else
            // (the format refused) still posts the slides, without links.
            if (err instanceof Error && /\b(190|200|10)\b|#(190|200|10)\b/.test(err.message)) throw err;
          }
          if (posted) {
            // Read back: a carousel drawn without its pictures is removed at once and the
            // slides go out as photos instead. A preview that cannot be read is kept.
            const pictures = await previewHasPicture(posted, linkPreview);
            if (pictures !== false) return { ok: true, id: posted };
            await call("DELETE", posted, {}, token).catch(() => undefined);
          }
        }
        // The page: each photo uploaded unpublished, then one feed post with all of them.
        const media: Record<string, string> = {};
        for (const [i, { url }] of images.entries()) {
          const photo = await call("POST", `${cfg.pageId}/photos`, { url, published: "false" }, token);
          media[`attached_media[${i}]`] = JSON.stringify({ media_fbid: String(photo.id) });
        }
        const r = await call("POST", `${cfg.pageId}/feed`, { message: caption, ...media }, token);
        return { ok: true, id: String(r.id) };
      } catch (err) {
        return fail(err);
      }
    },
    async refreshLink(link: string, preview?: string) {
      try {
        const token = await page();
        await warm([link, preview]);
        await call("POST", "", { id: link, scrape: "true" }, token);
        return true;
      } catch {
        return false;
      }
    },
    linkPreview,
    async linkOwnership(url: string) {
      try {
        return await canCustomize(url, await page());
      } catch {
        return null;
      }
    },
    async publishLink(link: string, caption: string, preview?: string) {
      try {
        const token = await page();
        // The page and its picture are drawn before Facebook's crawler asks: it leaves out
        // a picture (or a page) that is slow to come, and a first render after a deploy is.
        await warm([link, preview]);
        // Facebook reads the link's preview (title, picture) when the post is made, and a slow
        // picture is left out for good. Asking it to read the link first fills its cache with
        // the picture, so the post has it. Best effort: the post goes out either way.
        await scrape(link, token);
        const r = await call("POST", `${cfg.pageId}/feed`, { message: caption, link }, token);
        const id = String(r.id);
        // Read back: a preview without its picture is removed, and the caller posts a photo instead.
        const picture = await previewHasPicture(id, linkPreview);
        if (picture === false) {
          await call("DELETE", id, {}, token).catch(() => undefined);
          return { ok: false, error: NO_PICTURE };
        }
        return { ok: true, id };
      } catch (err) {
        return fail(err);
      }
    },
    async publishVideo(network: Network, videoUrl: string, caption: string) {
      try {
        if (network === "instagram")
          return await instagram({ media_type: "REELS", video_url: videoUrl, caption }, true);
        const r = await call(
          "POST",
          `${cfg.pageId}/videos`,
          { file_url: videoUrl, description: caption },
          await page(),
        );
        return { ok: true, id: String(r.id) };
      } catch (err) {
        return fail(err);
      }
    },
    async insights(network: Network, id: string): Promise<Insight | null> {
      try {
        if (network === "instagram") {
          const r = await call("GET", `${id}/insights`, { metric: "reach,likes,comments,shares" }, cfg.token);
          const v = Object.fromEntries(
            (
              (r.data as { name: string; values?: { value: number }[]; total_value?: { value: number } }[]) ??
              []
            ).map((m) => [m.name, m.total_value?.value ?? m.values?.[0]?.value ?? 0]),
          );
          return {
            reach: num(v.reach),
            reactions: num(v.likes),
            comments: num(v.comments),
            shares: num(v.shares),
            linkClicks: 0,
          };
        }
        const token = await page();
        const r = await call(
          "GET",
          id,
          { fields: "reactions.summary(total_count),comments.summary(total_count),shares" },
          token,
        );
        const total = (k: string) =>
          num((r[k] as { summary?: { total_count?: number } } | undefined)?.summary?.total_count);
        let reach = 0;
        let clicks = 0;
        try {
          const ins = await call(
            "GET",
            `${id}/insights`,
            { metric: "post_impressions_unique,post_clicks" },
            token,
          );
          for (const m of (ins.data as { name: string; values?: { value: number }[] }[]) ?? []) {
            if (m.name === "post_impressions_unique") reach = num(m.values?.[0]?.value);
            if (m.name === "post_clicks") clicks = num(m.values?.[0]?.value);
          }
        } catch {
          // Page insights need the page to have enough followers; reactions still count.
        }
        return {
          reach,
          reactions: total("reactions"),
          comments: total("comments"),
          shares: num((r.shares as { count?: number } | undefined)?.count),
          linkClicks: clicks,
        };
      } catch {
        return null;
      }
    },
    async remove(network: Network, id: string) {
      try {
        await call("DELETE", id, {}, network === "facebook" ? await page() : cfg.token);
        return true;
      } catch {
        return false;
      }
    },
    async tokenOk() {
      try {
        await call("GET", "me", { fields: "id" }, cfg.token);
        return true;
      } catch {
        return false;
      }
    },
  };
}
