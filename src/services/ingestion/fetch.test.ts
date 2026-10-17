import { describe, expect, it } from "vitest";
import { FeedFetchError, fetchFeed, isPrivateAddress } from "./fetch";

const resolvePublic = async () => ["93.184.216.34"];

function fakeFetch(responses: Record<string, () => Response>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    const make = responses[url];
    if (!make) throw new Error("unexpected url " + url);
    return make();
  }) as typeof fetch;
}

describe("isPrivateAddress", () => {
  it("flags loopback, RFC1918, link-local, CGNAT and v6 locals", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:10.0.0.1",
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });
  it("passes public addresses", () => {
    for (const ip of ["93.184.216.34", "172.32.0.1", "8.8.8.8", "2606:4700::1111"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
});

describe("fetchFeed", () => {
  const base = { allowedHosts: ["feeds.example.com", "*.cdn.example.com"], resolve: resolvePublic };

  it("returns the body of an allowed https feed", async () => {
    const body = await fetchFeed("https://feeds.example.com/feed.xml", {
      ...base,
      fetchImpl: fakeFetch({ "https://feeds.example.com/feed.xml": () => new Response("<rss/>") }),
    });
    expect(body).toBe("<rss/>");
  });

  it("rejects http://", async () => {
    await expect(fetchFeed("http://feeds.example.com/feed.xml", base)).rejects.toMatchObject({
      code: "scheme",
    });
  });

  it("rejects hosts outside the allow-list", async () => {
    await expect(fetchFeed("https://evil.example.org/feed.xml", base)).rejects.toMatchObject({
      code: "host_not_allowed",
    });
  });

  it("rejects hosts that resolve to private addresses", async () => {
    await expect(
      fetchFeed("https://feeds.example.com/feed.xml", { ...base, resolve: async () => ["10.0.0.5"] }),
    ).rejects.toMatchObject({ code: "private_address" });
  });

  it("follows a redirect inside the allow-list but not outside it", async () => {
    const fetchImpl = fakeFetch({
      "https://feeds.example.com/feed.xml": () =>
        new Response(null, { status: 302, headers: { location: "https://a.cdn.example.com/f.xml" } }),
      "https://a.cdn.example.com/f.xml": () => new Response("ok"),
      "https://feeds.example.com/bad.xml": () =>
        new Response(null, { status: 302, headers: { location: "https://evil.example.org/f.xml" } }),
    });
    expect(await fetchFeed("https://feeds.example.com/feed.xml", { ...base, fetchImpl })).toBe("ok");
    await expect(
      fetchFeed("https://feeds.example.com/bad.xml", { ...base, fetchImpl }),
    ).rejects.toMatchObject({ code: "host_not_allowed" });
  });

  it("caps the body size", async () => {
    const big = "x".repeat(2048);
    const fetchImpl = fakeFetch({ "https://feeds.example.com/feed.xml": () => new Response(big) });
    await expect(
      fetchFeed("https://feeds.example.com/feed.xml", { ...base, fetchImpl, maxBytes: 1024 }),
    ).rejects.toMatchObject({ code: "too_large" });
  });

  it("surfaces HTTP errors", async () => {
    const fetchImpl = fakeFetch({
      "https://feeds.example.com/feed.xml": () => new Response("nope", { status: 503 }),
    });
    await expect(
      fetchFeed("https://feeds.example.com/feed.xml", { ...base, fetchImpl }),
    ).rejects.toBeInstanceOf(FeedFetchError);
  });
});
