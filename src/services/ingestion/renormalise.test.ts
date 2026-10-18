import { describe, expect, it } from "vitest";
import { catalogVersion } from "@/domain/catalog/attributes";
import { renormaliseOne, VERSION_KEY } from "./renormalise";

const stored = {
  subcategoryId: "fridge",
  name: "Gorenje, 206 L, augstums 144 cm, pelēka - Ledusskapis ar saldētavu augšā",
  description: null,
  specTable: null,
};

describe("renormaliseOne", () => {
  it("derives attributes from stored text for rows ingested before attributes existed", () => {
    const next = renormaliseOne({ ...stored, attributes: {}, attributeSources: {} });
    expect(next.attributes).toMatchObject({ height_cm: 144, install: "free", doors: "two" });
    expect(next.sources[VERSION_KEY]).toBe(catalogVersion);
    expect(next.sources.height_cm).toBeDefined();
  });

  it("recomputes rule values but keeps feed, EPREL and extraction values", () => {
    const next = renormaliseOne({
      ...stored,
      attributes: { doors: "one", energy_class: "B", noise_db: 35 },
      attributeSources: { doors: "rule", energy_class: "eprel", noise_db: "claude" },
    });
    expect(next.attributes.doors).toBe("two"); // old rule output replaced
    expect(next.attributes.energy_class).toBe("B");
    expect(next.sources.energy_class).toBe("eprel");
    expect(next.attributes.noise_db).toBe(35);
  });

  it("treats values without a recorded source as feed values", () => {
    const next = renormaliseOne({ ...stored, attributes: { noise_db: 37 }, attributeSources: {} });
    expect(next.attributes.noise_db).toBe(37);
    expect(next.sources.noise_db).toBe("feed");
  });
});
