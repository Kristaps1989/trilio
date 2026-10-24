import { describe, expect, it } from "vitest";
import { attributeCatalog } from "@/domain/catalog/attributes";
import { catalog } from "@/domain/questions/catalog";
import {
  decidingAttrs,
  glossaryLine,
  knowledge,
  knowledgeOf,
  watchOutFor,
  type Knowledge,
} from "./knowledge";

describe("data/knowledge.json", () => {
  const subs = catalog.groups.flatMap((g) => g.subcategories);

  it("has an entry for every subcategory", () => {
    for (const s of subs) expect(knowledge.subcategories[s.id], s.id).toBeDefined();
  });

  it("names only attributes the subcategory captures", () => {
    for (const s of subs) {
      const def = attributeCatalog.subcategories[s.id]!;
      const known = new Set([...def.key, ...Object.keys(def.enums)]);
      const k = knowledge.subcategories[s.id]!;
      for (const d of k.decides) expect(known, `${s.id}.${d.attr}`).toContain(d.attr);
      for (const w of k.watchOut) expect(known, `${s.id}.${w.attr}`).toContain(w.attr);
    }
  });

  it("phrases verdicts only for questions that exist, with both placeholders", () => {
    for (const s of subs) {
      for (const [qid, text] of Object.entries(knowledge.subcategories[s.id]!.answerPhrases)) {
        expect(
          s.questions.map((q) => q.id),
          `${s.id}.${qid}`,
        ).toContain(qid);
        for (const lang of ["lv", "en"] as const) {
          expect(text[lang]).toContain("{answer}");
          expect(text[lang]).toContain("{value}");
        }
      }
    }
  });

  it("gives the deciding attributes and glossary lines, and nothing until reviewed", () => {
    expect(decidingAttrs("fridge")[0]).toBe("noise_db");
    expect(glossaryLine("no_frost", "en")).toMatch(/defrost/i);
    expect(glossaryLine("nothing", "lv")).toBeNull();
    const draft: Knowledge = { ...knowledge, reviewed: false };
    expect(knowledgeOf("fridge", draft).decides).toEqual([]);
    expect(knowledgeOf("unknown").decides).toEqual([]);
  });
});

describe("watch-out notes", () => {
  it("are shown only when the product's data confirms them", () => {
    expect(watchOutFor({ attributes: { door_reversible: false } }, "fridge", "lv")[0]).toMatch(/pārkārt/);
    expect(watchOutFor({ attributes: { door_reversible: true } }, "fridge", "en")).toEqual([]);
    expect(watchOutFor({ attributes: {} }, "fridge", "en")).toEqual([]);
  });
});
