import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getGroup } from "@/domain/questions/catalog";
import { Shell } from "@/ui/Shell";

type Params = { params: Promise<{ group: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { group } = await params;
  return { title: getGroup(group)?.label ?? "" };
}

/** Spec §2.1 step 2: subcategory list of a group. */
export default async function SubcategoriesPage({ params }: Params) {
  const { group } = await params;
  const g = getGroup(group);
  if (!g || g.id === "other") notFound();
  const t = await getTranslations("flow");
  return (
    <Shell>
      <p className="pt-4 text-sm font-semibold text-stone">{g.label}</p>
      <h1 className="mt-1 text-[28px] font-bold leading-[1.2] text-mist">{t("chooseSub")}</h1>
      <ul className="mt-6 flex flex-col gap-2">
        {g.subcategories.map((s) => (
          <li key={s.id}>
            <Link
              href={`/izvelies/${g.id}/${s.id}`}
              className="flex min-h-[60px] flex-col justify-center rounded-[14px] border-[1.5px] border-mist-32 bg-white-5 px-4 py-3"
            >
              <span className="text-[17px] font-semibold text-mist">{s.label}</span>
              {s.description ? <span className="text-sm text-stone">{s.description}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </Shell>
  );
}
