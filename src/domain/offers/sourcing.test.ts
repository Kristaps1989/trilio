import { describe, expect, it } from "vitest";
import { OFFER_ASK_MIN_PRICE_CENTS, trilioSources, worthAsking } from "./sourcing";

const all = { sourcing: ["*"], except: ["kettle"] };

describe("worthAsking", () => {
  it("asks for a lower price only from 200 € up, where the saving is worth a request", () => {
    expect(OFFER_ASK_MIN_PRICE_CENTS).toBe(20_000);
    expect(worthAsking("fridge", 50_500, all)).toBe(true);
    expect(worthAsking("fridge", 20_000, all)).toBe(true);
    expect(worthAsking("airfryer", 19_999, all)).toBe(false);
    expect(worthAsking("airfryer", 9_900, all)).toBe(false);
  });

  it("never where Trilio does not source, and keeps the category's answer when the price is unknown", () => {
    expect(trilioSources("kettle", all)).toBe(false);
    expect(worthAsking("kettle", 90_000, all)).toBe(false);
    expect(worthAsking("fridge", null, all)).toBe(true);
    expect(worthAsking("fridge", undefined, all)).toBe(true);
  });
});
