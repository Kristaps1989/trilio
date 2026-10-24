import type { DeltaItem } from "@/domain/delta/delta";
import { numberRule } from "@/domain/delta/delta";
import { formatEur, formatInt, formatNumber } from "@/i18n/format";

// Turns structured delta items into Latvian lines through the translator.
// Kept out of the domain so no copy lives in business logic.

type Translator = (key: string, values?: Record<string, string | number>) => string;

function num(n: number): string {
  return Number.isInteger(n) ? formatInt(n) : formatNumber(n);
}

export function deltaLines(
  items: DeltaItem[],
  t: Translator,
  attrLabel: (key: string) => string,
  enumLabel: (key: string, value: string) => string,
): string[] {
  return items.map((i) => {
    switch (i.kind) {
      case "number": {
        const abs = num(Math.abs(i.delta));
        // Lower is better (noise, weight, programme time, water): "par 4 dB klusāks".
        if (numberRule(i.key)?.higherIsBetter === false)
          return t(`${i.key}_${i.better ? "better" : "worse"}`, { delta: abs });
        const signed = (i.delta > 0 ? "+" : "−") + abs;
        return t(i.key, { delta: signed });
      }
      case "energy_class":
        return t(i.better ? "energy_class_better" : "energy_class_worse", { to: i.to });
      case "boolean":
        return t(i.gained ? "gained" : "lost", { feature: t(`feature.${i.key}`) });
      case "enum":
        return t("enum", { label: attrLabel(i.key), to: enumLabel(i.key, i.to) });
      case "energy_cost":
        return t(i.better ? "energy_cost_better" : "energy_cost_worse", {
          amount: formatEur(Math.abs(i.deltaCents)),
        });
      case "brand":
        return t(i.better ? (i.from === null ? "brand_proven" : "brand_better") : "brand_worse", {
          to: i.to,
        });
      case "fit":
        return i.text;
    }
  });
}
