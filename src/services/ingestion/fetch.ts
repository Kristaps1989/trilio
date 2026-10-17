import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// Fetches a partner feed with the guards a server-side fetcher of
// configured URLs needs: HTTPS only, host allow-list, no private or
// loopback addresses (SSRF), bounded redirects re-checked per hop, a body
// size cap and a timeout. Feed URLs come only from the `stores` table.

export type FetchFeedOptions = {
  allowedHosts: string[];
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
  /** Injected in tests; defaults to DNS lookup. */
  resolve?: (host: string) => Promise<string[]>;
  /** Overrides the default Accept header (the scraper asks for HTML). */
  accept?: string;
  /** Overrides the default User-Agent. */
  userAgent?: string;
};

export class FeedFetchError extends Error {
  constructor(
    message: string,
    readonly code:
      | "scheme"
      | "host_not_allowed"
      | "private_address"
      | "too_many_redirects"
      | "too_large"
      | "http_error"
      | "timeout",
    /** HTTP status for `http_error`. */
    readonly status?: number,
  ) {
    super(message);
  }
}

function hostAllowed(host: string, allowed: string[]): boolean {
  const h = host.toLowerCase();
  return allowed.some((a) => {
    const p = a.toLowerCase();
    return p.startsWith("*.") ? h.endsWith(p.slice(1)) || h === p.slice(2) : h === p;
  });
}

/** RFC 1918, loopback, link-local, CGNAT, unique-local, unspecified. */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::1" || v6 === "::") return true;
  if (v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80")) return true;
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return false;
}

async function defaultResolve(host: string): Promise<string[]> {
  if (isIP(host)) return [host];
  const records = await lookup(host, { all: true });
  return records.map((r) => r.address);
}

async function checkUrl(url: URL, opts: FetchFeedOptions, resolve: (h: string) => Promise<string[]>) {
  if (url.protocol !== "https:") throw new FeedFetchError(`feed URL must be https: ${url}`, "scheme");
  if (!hostAllowed(url.hostname, opts.allowedHosts)) {
    throw new FeedFetchError(`host not allowed: ${url.hostname}`, "host_not_allowed");
  }
  const addresses = await resolve(url.hostname);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new FeedFetchError(`host resolves to a private address: ${url.hostname}`, "private_address");
  }
}

export async function fetchFeed(feedUrl: string, opts: FetchFeedOptions): Promise<string> {
  return new TextDecoder("utf-8").decode(await fetchBytes(feedUrl, opts));
}

/** Same guards as fetchFeed, but returns the raw body (gzipped sitemaps). */
export async function fetchBytes(feedUrl: string, opts: FetchFeedOptions): Promise<Buffer> {
  const maxBytes = opts.maxBytes ?? 50 * 1024 * 1024;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const maxRedirects = opts.maxRedirects ?? 3;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const resolve = opts.resolve ?? defaultResolve;

  let url = new URL(feedUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let hop = 0; ; hop++) {
      await checkUrl(url, opts, resolve);
      const res = await fetchImpl(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          accept: opts.accept ?? "application/xml, text/xml, text/csv, text/plain;q=0.8, */*;q=0.5",
          "user-agent": opts.userAgent ?? "TrilioFeedBot/1.0",
        },
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location || hop >= maxRedirects)
          throw new FeedFetchError("too many redirects", "too_many_redirects");
        url = new URL(location, url);
        continue;
      }
      if (!res.ok) throw new FeedFetchError(`feed returned HTTP ${res.status}`, "http_error", res.status);
      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > maxBytes) throw new FeedFetchError("feed larger than limit", "too_large");
      return await readCapped(res, maxBytes);
    }
  } catch (err) {
    if (err instanceof FeedFetchError) throw err;
    if ((err as Error).name === "AbortError") throw new FeedFetchError("feed timed out", "timeout");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new FeedFetchError("feed larger than limit", "too_large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
