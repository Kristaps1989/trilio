import { describe, expect, it } from "vitest";
import { knowledgeOf } from "@/domain/knowledge/knowledge";
import { catalog } from "@/domain/questions/catalog";
import { composePost } from "@/domain/social/captions";
import { adviceFacts, flowPath } from "./facts";

describe("advice facts", () => {
  it("every category with knowledge gives a post that passes the lint", () => {
    for (const g of catalog.groups)
      for (const s of g.subcategories) {
        if (!knowledgeOf(s.id).decides.length) continue;
        const f = adviceFacts(s.id, 0);
        expect(f, s.id).not.toBeNull();
        expect(composePost(f!, { postId: "x", baseUrl: "https://t" }).issues, s.id).toEqual([]);
      }
  });

  it("passes over a factor written in the “tu” form", () => {
    const decides = knowledgeOf("micro").decides;
    const tu = decides.findIndex((d) => /\btavs\b/.test(d.why.lv));
    expect(tu).toBeGreaterThanOrEqual(0);
    expect(adviceFacts("micro", tu)!.kind === "advice" && adviceFacts("micro", tu)).not.toMatchObject({
      factor: decides[tu]!.why.lv,
    });
  });

  it("links to the category's first question", () => {
    expect(flowPath("fridge")).toBe("/izvelies/cool/fridge");
    expect(flowPath("nope")).toBe("/");
  });
});
