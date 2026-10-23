import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getGroup } from "@/domain/questions/catalog";
import { Kicker, PageTitle, Screen } from "@/ui/layout";
import { Illustration } from "@/ui/illustrations/Illustration";
import { Tile, TileGrid, TileIcon } from "@/ui/Tile";
import { pageMetadata } from "../../seo";

type Params = { params: Promise<{ group: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { group } = await params;
  const g = getGroup(group);
  if (!g) return {};
  const t = await getTranslations("meta");
  return pageMetadata(`/izvelies/${g.id}`, g.label, t("groupDescription", { group: g.label }));
}

/** Spec §2.1 step 2: subcategory list of a group. */
export default async function SubcategoriesPage({ params }: Params) {
  const { group } = await params;
  const g = getGroup(group);
  if (!g || g.id === "other") notFound();
  const t = await getTranslations("flow");
  return (
    <Screen>
      <Kicker>{g.label}</Kicker>
      <PageTitle>{t("chooseSub")}</PageTitle>
      <div className="mt-1.5">
        <TileGrid>
          {g.subcategories.map((s) => (
            <Tile
              key={s.id}
              href={`/izvelies/${g.id}/${s.id}`}
              icon={
                s.illustration ? (
                  <Illustration name={s.illustration} className="h-14 w-14 text-lime" />
                ) : (
                  <TileIcon path={g.icon_svg_path} />
                )
              }
              label={s.label}
              sublabel={s.description}
            />
          ))}
        </TileGrid>
      </div>
    </Screen>
  );
}
