import type { Metadata } from "next";
import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";
import { catalogIn } from "@/domain/questions/catalog";
import { Container, Lead, PageTitle, SectionTitle } from "@/ui/layout";
import { TileIcon } from "@/ui/Tile";
import { pageMetadata, withSharePreview } from "./seo";
import { activeLocale } from "@/i18n/active";
import { db } from "@/db";
import { savingsProofText } from "@/services/offers/proof";

// Welcome screen (spec §1, prototype "welcome") plus crawlable entry points
// below the fold: search engines and AI assistants need real links to the
// category pages, not just two buttons.

// Rendered per request so the site URL in metadata and JSON-LD comes from APP_URL at runtime.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const t = await getTranslations("meta");
  return withSharePreview(
    { ...pageMetadata("/", t("title"), t("description")), title: { absolute: t("title") } },
    await searchParams,
  );
}

export default async function WelcomePage() {
  const t = await getTranslations();
  const startGroups = catalogIn(activeLocale()).groups;
  const groups = startGroups.filter((g) => g.id !== "other");
  const steps = [t("home.how1"), t("home.how2"), t("home.how3")];
  const proof = await savingsProofText(db);
  return (
    <>
      {/* The first question is on the home page (docs/UX_REVIEW_PLAN.md §8): the promise and the
          proof on one side, "Ko tu meklē?" with the groups on the other, so choosing starts here. */}
      <section className="pt-4 pb-12 lg:pt-10">
        <Container
          size="wide"
          className="grid gap-x-12 gap-y-7 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:grid-rows-[auto_1fr]"
        >
          <div className="flex flex-col gap-4 lg:col-start-1 lg:row-start-1 lg:gap-5">
            <PageTitle scale="hero">{t("welcome.headline")}</PageTitle>
            {proof ? (
              <p className="max-w-[520px] text-[15px] font-semibold text-lime" data-home-proof>
                {proof}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-3 lg:col-start-2 lg:row-span-2 lg:row-start-1">
            <h2 className="font-heading text-[22px] font-semibold text-mist" id="start-title">
              {t("flow.chooseGroup")}
            </h2>
            <ul
              aria-labelledby="start-title"
              className="grid grid-cols-2 gap-[10px] sm:grid-cols-3"
              data-home-start
            >
              {startGroups.map((g) => {
                const other = g.id === "other";
                return (
                  <li key={g.id} className={other ? "col-span-full" : ""}>
                    <Link
                      href={other ? "/cits" : `/izvelies/${g.id}`}
                      className={`flex h-full gap-2.5 rounded-[14px] border-[1.5px] border-mist-32 bg-white-5 p-3.5 text-[15px] leading-[1.25] font-semibold text-mist transition-colors hover:border-lime hover:bg-lime-18 ${
                        other ? "min-h-[52px] items-center" : "min-h-[96px] flex-col justify-between"
                      }`}
                    >
                      <TileIcon path={g.icon_svg_path} />
                      <span>{g.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <Link
              href="/modelis"
              className="inline-flex min-h-11 items-center self-start text-base text-mist underline underline-offset-4"
            >
              {t("welcome.knowModel")}
            </Link>
          </div>
          {/* After the tiles on a phone, under the headline from 1024 px. */}
          <div className="flex flex-col gap-3 lg:col-start-1 lg:row-start-2">
            <Lead className="max-w-[520px]">{t("welcome.lead")}</Lead>
            <p className="max-w-[520px] text-sm text-stone">{t("welcome.meta")}</p>
          </div>
        </Container>
      </section>

      <Container size="wide" className="flex flex-col gap-14 pb-12">
        <section aria-labelledby="how-title" className="flex flex-col gap-5">
          <SectionTitle id="how-title">{t("home.howTitle")}</SectionTitle>
          <ol className="grid gap-[10px] md:grid-cols-3">
            {steps.map((text, i) => (
              <li
                key={text}
                className="flex flex-col gap-3 rounded-[14px] border-[1.5px] border-mist-32 bg-white-5 p-5"
              >
                <span
                  aria-hidden="true"
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-lime font-heading text-base font-bold text-night"
                >
                  {i + 1}
                </span>
                <span className="text-base leading-normal text-mist">{text}</span>
              </li>
            ))}
          </ol>
          <Link
            href="/par-trilio"
            className="inline-flex min-h-11 items-center self-start text-base text-lime underline"
          >
            {t("home.about")}
          </Link>
        </section>

        <section aria-labelledby="categories-title" className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <SectionTitle id="categories-title">{t("home.categoriesTitle")}</SectionTitle>
            <p className="text-base text-stone">{t("home.categoriesHint")}</p>
          </div>
          <div className="grid items-start gap-[10px] md:grid-cols-2 xl:grid-cols-3">
            {groups.map((g) => (
              <div
                key={g.id}
                className="flex flex-col gap-3 rounded-[14px] border-[1.5px] border-mist-32 bg-white-5 p-4"
              >
                <h3 className="text-base font-semibold text-mist">
                  <Link href={`/izvelies/${g.id}`} className="inline-flex min-h-11 items-center gap-3">
                    <TileIcon path={g.icon_svg_path} />
                    {g.label}
                  </Link>
                </h3>
                <ul className="flex flex-wrap gap-2">
                  {g.subcategories.map((s) => (
                    <li key={s.id}>
                      <Link
                        href={`/kategorija/${s.id}`}
                        className="flex min-h-11 items-center rounded-full bg-chip px-[14px] text-sm text-mist transition-colors hover:bg-lime-18"
                      >
                        {s.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </Container>
    </>
  );
}
