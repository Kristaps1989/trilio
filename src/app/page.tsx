import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { catalog } from "@/domain/questions/catalog";
import { ButtonLink } from "@/ui/Button";
import { Container, Kicker, Lead, PageTitle, SectionTitle } from "@/ui/layout";
import { TileIcon } from "@/ui/Tile";

// Welcome screen (spec §1, prototype "welcome") plus crawlable entry points
// below the fold: search engines and AI assistants need real links to the
// category pages, not just two buttons.

// Rendered per request so the site URL in metadata and JSON-LD comes from APP_URL at runtime.
export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  const t = await getTranslations();
  const groups = catalog.groups.filter((g) => g.id !== "other");
  const steps = [t("home.how1"), t("home.how2"), t("home.how3")];
  return (
    <>
      <section className="flex min-h-[calc(100dvh-200px)] items-center justify-center pt-2 pb-10">
        <Container size="text" className="flex flex-col gap-6">
          <Kicker>{t("welcome.kicker")}</Kicker>
          <PageTitle scale="hero">{t("welcome.headline")}</PageTitle>
          <Lead className="max-w-[600px]">{t("welcome.lead")}</Lead>
          <div className="mt-2 flex flex-wrap gap-3">
            <ButtonLink href="/izvelies" size="lg">
              {t("welcome.help")}
            </ButtonLink>
            <ButtonLink href="/modelis" size="lg" variant="outline">
              {t("welcome.knowModel")}
            </ButtonLink>
          </div>
          <p className="text-sm text-stone">{t("welcome.meta")}</p>
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
