// The Claude API compiles a structured-output schema into a grammar and refuses
// one that grows too large ("Schema is too complex"). Each optional field and
// each union roughly doubles part of it. The optimiser's 12 optional fields were
// refused in production on 26 Oct 2026; the schemas that work have at most 2.
// These limits are stricter than the API on purpose, and every schema Trilio
// sends is checked against them in a unit test (and by the e2e stand-in).

export const MAX_OPTIONAL = 4;
export const MAX_UNIONS = 4;

export function schemaComplexity(schema: unknown): { optional: number; unions: number } {
  let optional = 0;
  let unions = 0;
  const walk = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    const node = n as Record<string, unknown>;
    if (node.type === "object" && node.properties && typeof node.properties === "object") {
      const required = new Set((node.required as string[] | undefined) ?? []);
      for (const k of Object.keys(node.properties)) if (!required.has(k)) optional++;
    }
    if (node.anyOf || Array.isArray(node.type)) unions++;
    Object.values(node).forEach(walk);
  };
  walk(schema);
  return { optional, unions };
}
