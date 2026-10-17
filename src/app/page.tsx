import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { catalog } from "@/domain/questions/catalog";
import { Logo } from "@/ui/Logo";

// Welcome screen (spec §1) plus crawlable entry points: search engines and
// AI assistants need real links to the category pages, not just two buttons.

export default async function WelcomePage() {
  const t = await getTranslations();
  const groups = catalog.groups.filter((g) => g.id !== "other");
  return (
    <>
      <header className="flex items-center justify-between px-4 py-4">
        <Logo />
        <nav className="flex items-center gap-2">
          <Link
            href="/radars"
            className="flex min-h-11 items-center rounded-xl px-3 text-base font-semibold text-mist"
          >
            {t("header.radar")}
          </Link>
          <Link
            href="/ienakt"
            className="flex min-h-11 items-center rounded-xl border border-mist-32 px-4 text-base font-semibold text-mist"
          >
            {t("header.signIn")}
          </Link>
        </nav>
      </header>

      <main className="flex flex-1 flex-col gap-10 px-4 pb-8">
        <section className="flex flex-col justify-center gap-8 pt-6">
          <h1 className="text-[32px] font-bold leading-[1.15] text-mist sm:text-[40px]">
            {t("welcome.headline")}
          </h1>
          <div className="flex flex-col gap-3">
            <Link
              href="/izvelies"
              className="flex min-h-14 items-center justify-center rounded-button bg-lime px-6 text-lg font-bold text-night"
            >
              {t("welcome.help")}
            </Link>
            <Link
              href="/modelis"
              className="flex min-h-14 items-center justify-center rounded-button border-[1.5px] border-mist-32 bg-white-5 px-6 text-lg font-semibold text-mist"
            >
              {t("welcome.knowModel")}
            </Link>
          </div>
        </section>

        <section aria-labelledby="how-title" className="flex flex-col gap-3">
          <h2 id="how-title" className="text-xl font-bold text-mist">
            {t("home.howTitle")}
          </h2>
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-base text-stone">
            <li>{t("home.how1")}</li>
            <li>{t("home.how2")}</li>
            <li>{t("home.how3")}</li>
          </ol>
        </section>

        <section aria-labelledby="categories-title" className="flex flex-col gap-3">
          <h2 id="categories-title" className="text-xl font-bold text-mist">
            {t("home.categoriesTitle")}
          </h2>
          <p className="text-base text-stone">{t("home.categoriesHint")}</p>
          <div className="flex flex-col gap-4">
            {groups.map((g) => (
              <div key={g.id}>
                <h3 className="text-base font-semibold text-mist">
                  <Link href={`/izvelies/${g.id}`} className="inline-flex min-h-11 items-center">
                    {g.label}
                  </Link>
                </h3>
                <ul className="mt-1 flex flex-wrap gap-2">
                  {g.subcategories.map((s) => (
                    <li key={s.id}>
                      <Link
                        href={`/kategorija/${s.id}`}
                        className="flex min-h-11 items-center rounded-full border border-mist-32 bg-white-5 px-3 text-sm font-semibold text-mist"
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
      </main>

      <footer className="px-4 py-4 text-sm text-stone">{t("footer.tagline")}</footer>
    </>
  );
}
