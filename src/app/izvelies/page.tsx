import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { catalog } from "@/domain/questions/catalog";
import { Shell } from "@/ui/Shell";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("flow");
  return { title: t("chooseGroup") };
}

/** Spec §2.1 step 1: group tiles with icons; "Kaut kas cits" spans the full width. */
// Rendered per request so the site URL in metadata and JSON-LD comes from APP_URL at runtime.
export const dynamic = "force-dynamic";

export default async function GroupsPage() {
  const t = await getTranslations("flow");
  return (
    <Shell>
      <h1 className="pt-4 text-[28px] font-bold leading-[1.2] text-mist">{t("chooseGroup")}</h1>
      <p className="mt-2 text-base text-stone">{t("groupsHint")}</p>
      <ul className="mt-6 grid grid-cols-2 gap-3">
        {catalog.groups.map((g) => {
          const other = g.id === "other";
          return (
            <li key={g.id} className={other ? "col-span-2" : ""}>
              <Link
                href={other ? "/cits" : `/izvelies/${g.id}`}
                className="flex min-h-[112px] flex-col justify-between gap-3 rounded-[14px] border-[1.5px] border-mist-32 bg-white-5 p-4 text-[16px] font-semibold leading-[1.25] text-mist"
              >
                {g.icon_svg_path ? (
                  <svg
                    viewBox="0 0 24 24"
                    width="28"
                    height="28"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="text-lime"
                  >
                    <path d={g.icon_svg_path} />
                  </svg>
                ) : (
                  <span aria-hidden="true" className="text-lime">
                    …
                  </span>
                )}
                <span>{g.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Shell>
  );
}
