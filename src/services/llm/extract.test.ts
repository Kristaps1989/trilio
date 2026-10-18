import { describe, expect, it } from "vitest";
import { getSubcategory } from "@/domain/questions/catalog";
import { extractableAttributes, extractionSystem } from "./catalog-prompt";
import type { StructuredCaller } from "./client";
import { extractProduct, extractionUserPrompt, validateExtraction } from "./extract";

const fridge = getSubcategory("fridge")!;

describe("validateExtraction", () => {
  it("keeps the subcategory's keys with the right type, normalises energy class, drops the rest", () => {
    const out = validateExtraction(
      {
        attributes: [
          { key: "height_cm", value: 203 },
          { key: "noise_db", value: 38.44 },
          { key: "energy_class", value: "e" },
          { key: "no_frost", value: true },
          { key: "form", value: "combi" },
          { key: "width_cm", value: "60" }, // wrong type
          { key: "colour", value: "silver" }, // unknown key
          { key: "volume_l", value: -5 }, // implausible
          { key: "spin_rpm", value: 1400 }, // not a fridge attribute
        ],
        confidence: 83.6,
      },
      fridge,
    );
    expect(out.attributes).toEqual({
      height_cm: 203,
      noise_db: 38.4,
      energy_class: "E",
      no_frost: true,
      form: "combi",
    });
    expect(out.confidence).toBe(84);
  });

  it("enum values must be ones the catalogue lists; energy class must be A–G", () => {
    const out = validateExtraction(
      {
        attributes: [
          { key: "form", value: "huge" },
          { key: "energy_class", value: "Z" },
        ],
        confidence: 50,
      },
      fridge,
    );
    expect(out.attributes).toEqual({});
  });
});

describe("prompts", () => {
  it("system prompt is stable and lists the subcategory's attribute keys with enum values", () => {
    const a = extractionSystem(fridge);
    expect(a).toBe(extractionSystem(fridge));
    for (const key of Object.keys(extractableAttributes("fridge"))) expect(a).toContain(`- ${key} (`);
    expect(a).toContain("combi");
  });

  it("user prompt includes the spec table, wraps the text and caps it", () => {
    const u = extractionUserPrompt({
      name: "Bosch <b>KGN</b>",
      specs: "203 cm",
      description: "x".repeat(10_000),
      specTable: { augstums: "203 cm" },
    });
    expect(u).not.toContain("<b>");
    expect(u).toContain("Title: Bosch");
    expect(u).toContain("augstums: 203 cm");
    expect(u.length).toBeLessThan(4200);
  });
});

describe("extractProduct", () => {
  it("returns null when the caller fails and validated data when it succeeds", async () => {
    const failing: StructuredCaller = async () => ({ ok: false, reason: "cap" });
    expect(await extractProduct({ name: "x", specs: null, description: "y" }, fridge, failing)).toBeNull();

    const ok: StructuredCaller = async (req) => ({
      ok: true,
      value: req.schema.parse({ attributes: [{ key: "volume_l", value: 363 }], confidence: 90 }),
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    expect(await extractProduct({ name: "x", specs: null, description: "y" }, fridge, ok)).toEqual({
      attributes: { volume_l: 363 },
      confidence: 90,
    });
  });
});
