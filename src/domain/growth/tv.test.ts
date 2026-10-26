import { describe, expect, it } from "vitest";
import {
  landingWithTags,
  pixelUrl,
  shortLinkUrl,
  slugify,
  SLUG,
  viewerHash,
  viewerId,
  PIXEL_GIF,
} from "./tv";

describe("TV measurement links", () => {
  it("builds the tracker with Go3's macros and the short link", () => {
    expect(pixelUrl("https://trilio.lv", "go3-oktobris")).toBe(
      'https://trilio.lv/px/go3-oktobris?ord=[timestamp]&vid=#{request.keyValue("_fw_vcid2")}',
    );
    expect(shortLinkUrl("https://trilio.lv", "go3-oktobris")).toBe("https://trilio.lv/tv/go3-oktobris");
    expect(landingWithTags("/izvelies", "go3-oktobris")).toBe(
      "/izvelies?utm_source=go3&utm_medium=tv&utm_campaign=go3-oktobris",
    );
    expect(landingWithTags("/rezultati?sub=fridge", "x1")).toBe(
      "/rezultati?sub=fridge&utm_source=go3&utm_medium=tv&utm_campaign=x1",
    );
  });
  it("turns a name into a slug", () => {
    expect(slugify("Go3 — Ledusskapji oktobrī!")).toBe("go3-ledusskapji-oktobri");
    expect(SLUG.test("go3-ledusskapji-oktobri")).toBe(true);
    expect(SLUG.test("-x")).toBe(false);
  });
});

describe("viewer ids", () => {
  it("ignores macros the platform left unfilled", () => {
    expect(viewerId('#{request.keyValue("_fw_vcid2")}')).toBeNull();
    expect(viewerId("${VCID}")).toBeNull();
    expect(viewerId("[vid]")).toBeNull();
    expect(viewerId("%%VID%%")).toBeNull();
    expect(viewerId("")).toBeNull();
    expect(viewerId("a1b2c3-d4")).toBe("a1b2c3-d4");
  });
  it("hashes per campaign, never returning the id; falls back to IP and user agent", () => {
    const a = viewerHash("salt-a", { vid: "dev-1", ip: null, userAgent: null })!;
    expect(a).not.toContain("dev-1");
    expect(viewerHash("salt-a", { vid: "dev-1", ip: "1.2.3.4", userAgent: "x" })).toBe(a);
    expect(viewerHash("salt-b", { vid: "dev-1", ip: null, userAgent: null })).not.toBe(a);
    expect(viewerHash("salt-a", { vid: null, ip: "1.2.3.4", userAgent: "STB" })).toBeTruthy();
    expect(viewerHash("salt-a", { vid: null, ip: null, userAgent: "STB" })).toBeNull();
  });
  it("answers with a valid GIF", () => {
    expect(PIXEL_GIF.subarray(0, 6).toString()).toBe("GIF89a");
  });
});
