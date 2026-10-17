import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Logo } from "@/ui/Logo";

export default async function WelcomePage() {
  const t = await getTranslations();
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

      <main className="flex flex-1 flex-col justify-center gap-8 px-4 pb-8">
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
      </main>

      <footer className="px-4 py-4 text-sm text-stone">{t("footer.tagline")}</footer>
    </>
  );
}
