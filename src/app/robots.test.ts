import { describe, expect, it } from "vitest";
import robots from "./robots";

// robots.txt (docs/SOCIAL_PLAN.md §12): Facebook's crawler honours it, so a
// post's preview picture must be allowed while the rest of /api/ stays closed.

type Rule = { userAgent?: string | string[]; allow?: string | string[]; disallow?: string | string[] };
const list = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** The rule group for a crawler (its own group, else "*"), then the longest matching path wins; Allow wins a tie. */
function allowed(agent: string, path: string): boolean {
  const rules = list(robots().rules as Rule | Rule[] as never) as unknown as Rule[];
  const group =
    rules.find((r) => list(r.userAgent).some((a) => a.toLowerCase() === agent.toLowerCase())) ??
    rules.find((r) => list(r.userAgent).includes("*"))!;
  let best = { len: -1, allow: true };
  for (const [paths, allow] of [
    [list(group.allow), true],
    [list(group.disallow), false],
  ] as const)
    for (const p of paths)
      if (path.startsWith(p) && (p.length > best.len || (p.length === best.len && allow)))
        best = { len: p.length, allow };
  return best.allow;
}

const ID = "11111111-1111-4111-8111-111111111111";

describe("robots.txt", () => {
  it("lets link-preview crawlers read a page and its post picture", () => {
    for (const agent of [
      "facebookexternalhit",
      "Facebot",
      "LinkedInBot",
      "Twitterbot",
      "WhatsApp",
      "Googlebot",
    ]) {
      expect(allowed(agent, "/izvelies/cool/fridge"), agent).toBe(true);
      expect(allowed(agent, `/social/${ID}/link.jpg`), agent).toBe(true);
      expect(allowed(agent, `/social/${ID}/2`), agent).toBe(true);
      expect(allowed(agent, `/social/${ID}/2/square.jpg`), agent).toBe(true);
      expect(allowed(agent, `/api/social/${ID}/link.jpg`), agent).toBe(true);
      expect(allowed(agent, `/api/social/${ID}/1/image.jpg`), agent).toBe(true);
    }
  });
  it("keeps the rest of /api/ and the private pages closed", () => {
    for (const agent of ["facebookexternalhit", "Googlebot", "GPTBot"]) {
      expect(allowed(agent, "/api/visit"), agent).toBe(false);
      expect(allowed(agent, "/api/cron/social"), agent).toBe(false);
      expect(allowed(agent, "/admin/sociali"), agent).toBe(false);
      expect(allowed(agent, "/go/abc"), agent).toBe(false);
    }
  });
});
