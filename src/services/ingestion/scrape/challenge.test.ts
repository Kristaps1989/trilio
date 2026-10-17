import { describe, expect, it } from "vitest";
import { detectBlock } from "./challenge";

describe("detectBlock", () => {
  it("recognises Cloudflare challenge and block pages", () => {
    expect(detectBlock("<html><head><title>Just a moment...</title>")).toBe("cloudflare_challenge");
    expect(detectBlock("<title>Attention Required! | Cloudflare</title>")).toBe("cloudflare_block");
    expect(detectBlock('<script src="https://challenges.cloudflare.com/x"></script>')).toBe(
      "cloudflare_challenge",
    );
  });

  it("recognises a tiny JavaScript cookie redirect", () => {
    expect(
      detectBlock('<script>window.setTimeout(function(){document.location.href = "/";}, 5);</script>'),
    ).toBe("javascript_challenge");
  });

  it("passes normal pages", () => {
    const page = "<html><title>Ledusskapis</title>" + "x".repeat(5000) + "document.location.href='/'";
    expect(detectBlock(page)).toBeNull();
  });
});
