import { getTranslations } from "next-intl/server";
import type { EnergyLabel } from "@/domain/catalog/media";

// The EU energy class arrow with links to the official label and the product
// information sheet in EPREL (docs/PICTURES_AND_LLM_PLAN.md §2). Colours are
// the label's A–G scale; the dark letter keeps large-text contrast on each.
// Both links say, for screen readers, that they open EPREL in a new tab.

const CLASS_COLOURS: Record<string, string> = {
  A: "#00a651",
  B: "#50b848",
  C: "#bed630",
  D: "#fff200",
  E: "#fdb913",
  F: "#f37021",
  G: "#ed1c24",
};

const link = "inline-flex min-h-11 items-center font-semibold underline underline-offset-2";

export async function EnergyBadge({ label }: { label: EnergyLabel }) {
  const t = await getTranslations("results");
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span
        className="inline-flex h-8 min-w-12 items-center pr-4 pl-2.5 font-heading text-xl leading-none font-bold text-night [clip-path:polygon(0_0,calc(100%-14px)_0,100%_50%,calc(100%-14px)_100%,0_100%)]"
        style={{ backgroundColor: CLASS_COLOURS[label.energyClass] }}
        role="img"
        aria-label={t("energyClass", { cls: label.energyClass })}
        title={t("energyClass", { cls: label.energyClass })}
      >
        {label.energyClass}
      </span>
      <a href={label.labelUrl} target="_blank" rel="noopener" className={link}>
        {t("energyLabel")}
        <span className="sr-only"> {t("externalEprel")}</span>
      </a>
      <a href={label.sheetUrl} target="_blank" rel="noopener" className={link}>
        {t("energySheet")}
        <span className="sr-only"> {t("externalEprel")}</span>
      </a>
    </div>
  );
}
