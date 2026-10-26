import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { Copy } from "@/services/ads/creatives";
import {
  EMPTY_PROPOSAL_FIELDS,
  MemoOutput,
  OptimiserOutput,
  TermsOutput,
  toProposal,
} from "@/services/ads/optimiser";
import { ExtractionOutputSchema } from "./extract";
import { routerOutputSchema } from "./router";
import { MAX_OPTIONAL, MAX_UNIONS, schemaComplexity } from "./schema-complexity";

// Every schema Trilio sends to Claude, as the SDK sends it: small enough to compile.

const SCHEMAS: [string, z.ZodType][] = [
  ["ads optimiser", OptimiserOutput],
  ["ads search terms", TermsOutput],
  ["ads memo", MemoOutput],
  ["ad copy", Copy],
  ["attribute extraction", ExtractionOutputSchema],
  ["free-text routing", routerOutputSchema()],
];

describe("structured-output schemas", () => {
  for (const [name, schema] of SCHEMAS)
    it(`${name} stays within the compile limits`, () => {
      const c = schemaComplexity(zodOutputFormat(schema).schema);
      expect(c.optional).toBeLessThanOrEqual(MAX_OPTIONAL);
      expect(c.unions).toBeLessThanOrEqual(MAX_UNIONS);
    });

  it("counts what the API counts", () => {
    expect(
      schemaComplexity({
        type: "object",
        properties: { a: { type: "string" }, b: { type: ["string", "null"] }, c: { anyOf: [] } },
        required: ["a"],
      }),
    ).toEqual({ optional: 2, unions: 2 });
  });

  it("drops a proposal's empty fields before the guardrails read it", () => {
    expect(
      toProposal({
        ...EMPTY_PROPOSAL_FIELDS,
        headlines: [],
        descriptions: [],
        action: "set_cpc",
        adGroupId: "g1",
        cpcCapCents: 35,
        reason: "r",
        expectedEffect: "e",
        confidence: 70,
      }),
    ).toEqual({ action: "set_cpc", adGroupId: "g1", cpcCapCents: 35 });
  });
});
