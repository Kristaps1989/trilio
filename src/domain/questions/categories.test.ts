import { describe, expect, it } from "vitest";
import raw from "../../../data/categories.json";
import { attributeCatalog } from "@/domain/catalog/attributes";
import { allSubcategories, catalog, detectSubcategory, getSubcategory } from "./catalog";
import { CatalogSchema } from "./schema";

// Guards the data file: a bad edit fails CI before it reaches the UI. The
// core rules of docs/FILTERS_PLAN.md are checked here for every category.

describe("data/categories.json", () => {
  it("matches the schema", () => {
    const result = CatalogSchema.safeParse(raw);
    expect(result.success, result.success ? "" : JSON.stringify(result.error.issues, null, 2)).toBe(true);
  });

  it("has 8 groups plus 'other', and 33 subcategories", () => {
    expect(catalog.groups).toHaveLength(9);
    expect(allSubcategories()).toHaveLength(33);
  });

  it("core rule 1: every flow question says why it is asked up front", () => {
    for (const sub of allSubcategories()) {
      for (const q of sub.questions.filter((x) => x.stage === "flow")) {
        expect(["fit", "price", "kind"], `${sub.id}.${q.id}`).toContain(q.up_front_reason);
      }
    }
  });

  it("core rule 3: pictures where the shape or size decides, all-or-nothing within a question", () => {
    const SIZE = /^(height|width|depth)_cm$/;
    for (const sub of allSubcategories()) {
      for (const q of sub.questions) {
        const real = q.options.filter((o) => !o.passthrough);
        const drawn = real.filter((o) => o.illustration).length;
        expect([0, real.length], `${sub.id}.${q.id}: every option drawn or none`).toContain(drawn);
        // A choice between sizes is always shown as pictures drawn to one scale.
        const sizeChoice = real.length > 0 && real.every((o) => o.match?.some((m) => SIZE.test(m.attr)));
        if (q.stage === "flow" && sizeChoice) expect(drawn, `${sub.id}.${q.id}`).toBe(real.length);
      }
    }
  });

  it("every answer condition refers to a real attribute and enum value", () => {
    for (const sub of allSubcategories()) {
      const attrs = attributeCatalog.subcategories[sub.id]!;
      for (const q of sub.questions) {
        const keys = [
          ...q.options.flatMap((o) => (o.match ?? []).map((m) => m)),
          ...(q.range ? [{ attr: q.range.attr }] : []),
          ...(q.input?.attr ? [{ attr: q.input.attr }] : []),
        ];
        for (const m of keys) {
          const isEnum = !!attrs.enums[m.attr];
          expect(isEnum || !!attributeCatalog.attributes[m.attr], `${sub.id}.${q.id}: ${m.attr}`).toBe(true);
          const eq = (m as { eq?: unknown }).eq;
          if (isEnum && typeof eq === "string") {
            expect(attrs.enums[m.attr]!.values, `${sub.id}.${q.id}: ${m.attr}=${eq}`).toContain(eq);
          }
        }
      }
      for (const key of sub.compare) {
        expect(!!attrs.enums[key] || !!attributeCatalog.attributes[key], `${sub.id} compare ${key}`).toBe(
          true,
        );
      }
    }
  });

  it("hard choice options either have attribute conditions or are passthrough", () => {
    for (const sub of allSubcategories()) {
      for (const q of sub.questions) {
        if (!q.hard_filter || q.type === "number" || q.type === "range") continue;
        for (const o of q.options)
          expect(!!o.match || !!o.passthrough, `${sub.id}.${q.id}.${o.value}`).toBe(true);
      }
    }
  });

  it("every 'I don't know' style option is passthrough", () => {
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

  it("budget steps are ascending (they are the price presets)", () => {
    for (const sub of allSubcategories()) {
      const steps = sub.budget_steps_eur;
      expect(
        [...steps].sort((a, b) => a - b),
        sub.id,
      ).toEqual(steps);
    }
  });

  it("every subcategory has attribute data", () => {
    for (const sub of allSubcategories())
      expect(attributeCatalog.subcategories[sub.id], sub.id).toBeDefined();
  });
});
