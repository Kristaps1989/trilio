import { describe, expect, it } from "vitest";
import raw from "../../../data/categories.json";
import { allSubcategories, catalog, detectSubcategory, getSubcategory } from "./catalog";
import { CatalogSchema } from "./schema";

// Guards the data file: a bad edit fails CI before it reaches the UI.

describe("data/categories.json", () => {
  it("matches the schema", () => {
    const result = CatalogSchema.safeParse(raw);
    expect(result.success, result.success ? "" : JSON.stringify(result.error.issues, null, 2)).toBe(true);
  });

  it("has 8 groups plus 'other', and 33 subcategories", () => {
    expect(catalog.groups).toHaveLength(9);
    expect(allSubcategories()).toHaveLength(33);
  });

  it("no subcategory still uses a bespoke flow", () => {
    for (const sub of allSubcategories()) {
      expect(sub.custom_flow ?? false, sub.id).toBe(false);
      expect(sub.questions.length, sub.id).toBeGreaterThan(0);
      expect(sub.budget_steps_eur.length, sub.id).toBeGreaterThanOrEqual(3);
    }
  });

  it("every hard-filter single question with an 'I don't know' option marks it passthrough", () => {
    for (const sub of allSubcategories()) {
      for (const q of sub.questions) {
        for (const o of q.options) {
          if (o.label === "Nezinu" || o.label === "Nav svarīgi" || o.value === "any") {
            expect(o.passthrough, `${sub.id}.${q.id}.${o.value}`).toBe(true);
          }
        }
      }
    }
  });

  it("no option is labelled 'Dizains' (cannot be scored from data)", () => {
    for (const sub of allSubcategories()) {
      for (const q of sub.questions) {
        expect(
          q.options.map((o) => o.label),
          `${sub.id}.${q.id}`,
        ).not.toContain("Dizains");
      }
    }
  });

  it("subcategory ids are unique and the free-text table references real ones", () => {
    const ids = allSubcategories().map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const rule of catalog.free_text_detection) {
      expect(getSubcategory(rule.subcategory), rule.subcategory).toBeDefined();
      expect(() => new RegExp(rule.regex, "i")).not.toThrow();
    }
  });

  it("free-text detection routes a sample request", () => {
    expect(detectSubcategory("Vajag rokas blenderi zupām")).toBe("handblender");
    expect(detectSubcategory("gribu jaunu televizoru")).toBeNull();
  });

  it("budget steps are ascending", () => {
    for (const sub of allSubcategories()) {
      const steps = sub.budget_steps_eur;
      expect(
        [...steps].sort((a, b) => a - b),
        sub.id,
      ).toEqual(steps);
    }
  });
});
