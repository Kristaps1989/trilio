import { describe, expect, it } from "vitest";
import { getSubcategory } from "@/domain/questions/catalog";
import { ATTRIBUTE_KEYS, extractionSystem } from "./catalog-prompt";
import type { StructuredCaller } from "./client";
import { extractProduct, extractionUserPrompt, mergeExtraction, validateExtraction } from "./extract";

const fridge = getSubcategory("fridge")!;

describe("validateExtraction", () => {
  it("keeps known keys with the right type, normalises energy class, drops the rest", () => {
    const out = validateExtraction(
      {
        attributes: [
          { key: "height_cm", value: 203 },
          { key: "noise_db", value: 38.44 },
          { key: "energy_class", value: "e" },
          { key: "no_frost", value: true },
          { key: "width_cm", value: "60" }, // wrong type
          { key: "colour", value: "silver" }, // unknown key
          { key: "volume_l", value: -5 }, // implausible
          { key: "climate_class", value: " SN-T " },
        ],
        tags: ["free", "nofrost", "quiet", "turbo", "any"],
        confidence: 83.6,
      },
      fridge,
    );
    expect(out.attributes).toEqual({
      height_cm: 203,
      noise_db: 38.4,
      energy_class: "E",
      no_frost: true,
      climate_class: "SN-T",
    });
    expect(out.tags).toEqual(["free", "nofrost", "quiet"]);
    expect(out.confidence).toBe(84);
  });

  it("rejects an energy class outside A–G", () => {
    const out = validateExtraction(
      { attributes: [{ key: "energy_class", value: "A+++" }], tags: [], confidence: 50 },
      fridge,
    );
    expect(out.attributes).toEqual({ energy_class: "A" });
    const bad = validateExtraction(
      { attributes: [{ key: "energy_class", value: "Z" }], tags: [], confidence: 50 },
      fridge,
    );
    expect(bad.attributes).toEqual({});
  });
});

describe("mergeExtraction", () => {
  it("feed attributes win, extracted ones fill gaps, tags are unioned", () => {
    const merged = mergeExtraction(
      { attributes: { height_cm: 185, energy_class: "D" }, tags: ["free"] },
      { attributes: { height_cm: 203, noise_db: 35 }, tags: ["free", "quiet"], confidence: 80 },
    );
    expect(merged.attributes).toEqual({ height_cm: 185, energy_class: "D", noise_db: 35 });
    expect(merged.tags).toEqual(["free", "quiet"]);
  });
});

describe("prompts", () => {
  it("system prompt is stable and lists the subcategory's option values and attribute keys", () => {
    const a = extractionSystem(fridge);
    expect(a).toBe(extractionSystem(fridge));
    expect(a).toContain('builtin="Iebūvējams');
    for (const key of Object.keys(ATTRIBUTE_KEYS)) expect(a).toContain(`- ${key} (`);
  });

  it("user prompt wraps the text and caps it", () => {
    const u = extractionUserPrompt({
      name: "Bosch <b>KGN</b>",
      specs: "203 cm",
      description: "x".repeat(10_000),
    });
    expect(u).not.toContain("<b>");
    expect(u).toContain("Title: Bosch");
    expect(u.length).toBeLessThan(4200);
  });
});

describe("extractProduct", () => {
  it("returns null when the caller fails and validated data when it succeeds", async () => {
    const failing: StructuredCaller = async () => ({ ok: false, reason: "cap" });
    expect(await extractProduct({ name: "x", specs: null, description: "y" }, fridge, failing)).toBeNull();

    const ok: StructuredCaller = async (req) => ({
      ok: true,
      value: req.schema.parse({
        attributes: [{ key: "volume_l", value: 363 }],
        tags: ["yes"],
        confidence: 90,
      }),
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    expect(await extractProduct({ name: "x", specs: null, description: "y" }, fridge, ok)).toEqual({
      attributes: { volume_l: 363 },
      tags: ["yes"],
      confidence: 90,
    });
  });
});
