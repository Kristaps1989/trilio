import { getTranslations } from "next-intl/server";
import { FilterLinks } from "../ui";

// The Reklāma section's own tabs and the one-line outcome of the last action.

const TABS = [
  ["overview", "/admin/reklama"],
  ["campaigns", "/admin/reklama/kampanas"],
  ["proposals", "/admin/reklama/priekslikumi"],
  ["keywords", "/admin/reklama/atslegvardi"],
  ["creatives", "/admin/reklama/reklamas"],
  ["strategy", "/admin/reklama/strategija"],
  ["seo", "/admin/reklama/seo"],
] as const;

export async function AdsNav({ active }: { active: (typeof TABS)[number][0] }) {
  const t = await getTranslations("admin.ads.nav");
  return (
    <FilterLinks
      label={t("label")}
      items={TABS.map(([key, href]) => ({ href, label: t(key), active: key === active }))}
    />
  );
}

export function Outcome({ ok, err }: { ok?: string | null; err?: string | null }) {
  if (!ok && !err) return null;
  return (
    <p
      role="status"
      className={`rounded-[14px] px-4 py-3 ${err ? "bg-warning text-night" : "bg-lime-12 text-mist"}`}
      data-outcome={err ? "error" : "ok"}
    >
      {ok ?? err}
    </p>
  );
}

export const eurFromMicros = (micros: number) =>
  new Intl.NumberFormat("lv-LV", { style: "currency", currency: "EUR" }).format(micros / 1_000_000);
export const eurFromCents = (cents: number) =>
  new Intl.NumberFormat("lv-LV", { style: "currency", currency: "EUR" }).format(cents / 100);
