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

export function metaProvider(
  cfg: MetaConfig,
  http: Fetch = fetch,
  wait = (ms: number) => new Promise((r) => setTimeout(r, ms)),
): SocialProvider {
  const base = `https://graph.facebook.com/${cfg.version}`;
  let pageToken: string | null = null;

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
        if (link && images.every((i) => i.card)) {
          // A link carousel: every card opens its own page (multi-link share, child_attachments).
          // The order is ours (not "optimized"), and no extra end card is added.
          try {
            const r = await call(
              "POST",
              `${cfg.pageId}/feed`,
              {
                message: caption,
                link,
                child_attachments: JSON.stringify(
                  images.map(({ card }) => ({
                    link: card!.link,
                    name: card!.name,
                    ...(card!.description ? { description: card!.description } : {}),
                    picture: card!.picture,
                  })),
                ),
                multi_share_optimized: "false",
                multi_share_end_card: "false",
              },
              token,
            );
            return { ok: true, id: String(r.id) };
          } catch (err) {
            // A token or page problem fails the same way below; anything else
            // (the format refused) still posts the slides, without links.
            if (err instanceof Error && /\b(190|200|10)\b|#(190|200|10)\b/.test(err.message)) throw err;
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
