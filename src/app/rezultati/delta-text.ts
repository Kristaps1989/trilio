import type { DeltaItem } from "@/domain/delta/delta";
import { formatEur, formatInt } from "@/i18n/format";

// Turns structured delta items into Latvian lines through the translator.
// Kept out of the domain so no copy lives in business logic.

type Translator = (key: string, values?: Record<string, string | number>) => string;

export function deltaLines(items: DeltaItem[], t: Translator): string[] {
  return items.map((i) => {
    switch (i.kind) {
      case "number": {
        const signed = (i.delta > 0 ? "+" : "−") + formatInt(Math.abs(i.delta));
        if (i.key === "noise_db") {
          return t(i.better ? "noise_db_better" : "noise_db_worse", { delta: formatInt(Math.abs(i.delta)) });
        }
        return t(i.key, { delta: signed });
      }
      case "energy_class":
        return t(i.better ? "energy_class_better" : "energy_class_worse", { to: i.to });
      case "boolean":
        return t(i.gained ? "gained" : "lost", { feature: t(`feature.${i.key}`) });
      case "energy_cost":
        return t(i.better ? "energy_cost_better" : "energy_cost_worse", {
          amount: formatEur(Math.abs(i.deltaCents)),
        });
    }
  });
}
