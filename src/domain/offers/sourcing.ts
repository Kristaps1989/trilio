import data from "../../../data/offers.json";

// Where Trilio can make its own offer (data/offers.json). The owner's decision
// (30 Oct 2026) is every category ("*"); the file can still narrow it or leave
// categories out. There the results promise "Trilio var piedāvāt lētāk" and
// the notify consent includes Trilio's offers (docs/PRICE_NOTIFY_PLAN.md).

export type Sourcing = { sourcing: readonly string[]; except?: readonly string[] };

export function trilioSources(subcategoryId: string, config: Sourcing = data): boolean {
  if (config.except?.includes(subcategoryId)) return false;
  return config.sourcing.includes("*") || config.sourcing.includes(subcategoryId);
}
