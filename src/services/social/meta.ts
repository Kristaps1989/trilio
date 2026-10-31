import type { Insight, Network, PublishResult, SocialProvider } from "./provider";

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

  /** Instagram: a container, (for video) wait until Meta has fetched it, then publish. */
  async function instagram(params: Record<string, string>, video: boolean): Promise<PublishResult> {
    const created = await call("POST", `${cfg.igUserId}/media`, params, cfg.token);
    const container = String(created.id);
    if (video) {
      for (let i = 0; i < 30; i++) {
        const s = await call("GET", container, { fields: "status_code" }, cfg.token);
        if (s.status_code === "FINISHED") break;
        if (s.status_code === "ERROR" || s.status_code === "EXPIRED")
          throw new Error(`Instagram video ${String(s.status_code)}`);
        await wait(5_000);
      }
    }
    const published = await call(
      "POST",
      `${cfg.igUserId}/media_publish`,
      { creation_id: container },
      cfg.token,
    );
    return { ok: true, id: String(published.id) };
  }

  const num = (v: unknown) => (typeof v === "number" ? v : 0);

  return {
    name: "meta",
    async publishImage(network: Network, imageUrl: string, caption: string) {
      try {
        if (network === "instagram") return await instagram({ image_url: imageUrl, caption }, false);
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
