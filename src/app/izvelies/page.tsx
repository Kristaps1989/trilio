import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { catalog } from "@/domain/questions/catalog";
import { Kicker, Lead, PageTitle, Screen } from "@/ui/layout";
import { Tile, TileGrid, TileIcon } from "@/ui/Tile";

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
    <Screen>
      <Kicker>{t("guideKicker")}</Kicker>
      <PageTitle>{t("chooseGroup")}</PageTitle>
      <Lead>{t("groupsHint")}</Lead>
      <div className="mt-1.5">
        <TileGrid>
          {catalog.groups.map((g) => {
            const other = g.id === "other";
            return (
              <Tile
                key={g.id}
                wide={other}
                href={other ? "/cits" : `/izvelies/${g.id}`}
                icon={<TileIcon path={g.icon_svg_path} />}
                label={g.label}
              />
            );
          })}
        </TileGrid>
      </div>
    </Screen>
  );
}
