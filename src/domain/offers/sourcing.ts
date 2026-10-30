import data from "../../../data/offers.json";

// Where Trilio can make its own offer (data/offers.json, kept true by the
// owner). Only there do the results promise "Trilio var piedāvāt lētāk" and
// does the notify consent include Trilio's offers (docs/PRICE_NOTIFY_PLAN.md).

const SOURCING = new Set<string>(data.sourcing);

export function trilioSources(subcategoryId: string, list: ReadonlySet<string> = SOURCING): boolean {
  return list.has(subcategoryId);
}
