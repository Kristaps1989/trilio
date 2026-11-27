import { createTranslator } from "next-intl";
import { enumLabels, formatAttr } from "@/app/[locale]/rezultati/attr-format";
import { deltaLines } from "@/app/[locale]/rezultati/delta-text";
import { upgradeDelta } from "@/domain/delta/delta";
import { energyPriceFromEnv } from "@/domain/energy/energy";
import type { Subcategory } from "@/domain/questions/schema";
import type { Pick } from "@/domain/ranking/rank";
import lv from "@/i18n/messages/lv.json";

// What the results page says about each of the three picks, for the page's posts and the agent's
// ads (owner, 27 Nov 2026: a slide per product with its strengths, as Trilio compares them): its
// key specs in one line, and what it gives and does worse than the cheapest of the three. The
// same functions and the same Latvian texts as the site's card, so a post never says more.

type Translator = (key: string, values?: Record<string, string | number>) => string;

export type PickNote = { specs: string | null; gains: string[]; tradeoffs: string[] };

export function pickNotes(picks: Pick[], sub: Subcategory, energyPrice = energyPriceFromEnv()): PickNote[] {
  const ta = createTranslator({ locale: "lv", messages: lv, namespace: "attr" }) as unknown as Translator & {
    has: (k: string) => boolean;
  };
  const td = createTranslator({ locale: "lv", messages: lv, namespace: "delta" }) as unknown as Translator;
  const enums = enumLabels(sub);
  const attrLabel = (key: string) => (ta.has(key) ? ta(key) : key);
  const enumLabel = (key: string, value: string) => enums[key]?.[value] ?? value;

  // The site's spec line: the feed's own, else the first four known compare attributes.
  const specsOf = (p: Pick["product"]): string | null => {
    if (p.specs) return p.specs;
    const parts: string[] = [];
    for (const key of sub.compare) {
      const v = p.attributes[key];
      if (v === undefined || v === null || v === "" || v === false) continue;
      const value = v === true ? attrLabel(key) : formatAttr(key, v, ta, enums);
      parts.push(key.endsWith("_cm") ? `${attrLabel(key).toLowerCase()} ${value}` : value);
      if (parts.length === 4) break;
    }
    return parts.length ? parts.join(" · ") : null;
  };

  const cheapest = picks.reduce((a, b) => (b.offer.priceCents < a.offer.priceCents ? b : a), picks[0]!);
  return picks.map((pick) => {
    const note: PickNote = { specs: specsOf(pick.product), gains: [], tradeoffs: [] };
    if (pick.product.id === cheapest.product.id) return note;
    const d = upgradeDelta(
      { product: cheapest.product, priceCents: cheapest.offer.priceCents, reasons: cheapest.reasons },
      { product: pick.product, priceCents: pick.offer.priceCents, reasons: pick.reasons },
      energyPrice,
      sub.compare,
      sub.id,
    );
    // As on the site: say nothing rather than guess when the specs are not known on both sides.
    if (d.status === "unknown") return note;
    note.gains = deltaLines(d.gains, td, attrLabel, enumLabel);
    note.tradeoffs = deltaLines(d.tradeoffs, td, attrLabel, enumLabel, { downside: true });
    return note;
  });
}
