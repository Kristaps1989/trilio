import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Logo } from "./Logo";
import { BackButton } from "./BackButton";
import { LegalLinks } from "./LegalLinks";

/** Header (logo, radar, sign in), content, footer (tagline, back). Spec §1. */
export async function Shell({ children, back = true }: { children: ReactNode; back?: boolean }) {
  const t = await getTranslations();
  return (
    <>
      <header className="flex items-center justify-between px-4 py-4">
        <Link href="/" className="flex min-h-11 items-center" aria-label="Trilio">
          <Logo />
        </Link>
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
      <main className="flex flex-1 flex-col px-4 pb-8">{children}</main>
      <footer className="flex flex-col gap-2 px-4 py-4 text-sm text-stone">
        <div className="flex items-center justify-between gap-4">
          <span>{t("footer.tagline")}</span>
          {back ? <BackButton label={t("footer.back")} /> : null}
        </div>
        <LegalLinks />
      </footer>
    </>
  );
}
