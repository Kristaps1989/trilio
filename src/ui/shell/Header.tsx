"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Logo } from "../Logo";

// One header for every screen, rendered once by the root layout so it never
// re-mounts between pages. The signed-in state is read on the client from
// Auth.js, which keeps landing pages cacheable.

type Session = { user?: { name?: string | null; email?: string | null } } | null;

function initialOf(session: Session): string | null {
  const source = session?.user?.name || session?.user?.email;
  return source ? source.trim().charAt(0).toUpperCase() : null;
}

export function RadarIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 12l6-6" />
    </svg>
  );
}

export function Header() {
  const t = useTranslations("header");
  const pathname = usePathname();
  const [session, setSession] = useState<Session | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/session", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: Session) => alive && setSession(s && s.user ? s : null))
      .catch(() => alive && setSession(null));
    return () => {
      alive = false;
    };
    // Re-checked on navigation so signing in or out updates the header.
  }, [pathname]);

  const initial = initialOf(session ?? null);
  const onSignIn = pathname === "/ienakt";

  return (
    <header className="sticky top-1 z-40 flex items-center justify-between gap-3 border-b border-line-25 bg-night px-gutter py-4">
      <Link href="/" className="flex min-h-11 items-center" aria-label={t("home")}>
        <Logo />
      </Link>
      <nav aria-label={t("nav")} className="flex items-center gap-2">
        <Link
          href="/radars"
          aria-current={pathname.startsWith("/radars") ? "page" : undefined}
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line-30 px-[14px] text-sm font-semibold text-mist"
        >
          <RadarIcon className="text-lime" />
          <span className="max-[379px]:sr-only">{t("radar")}</span>
        </Link>
        {initial ? (
          <Link
            href="/konts"
            aria-label={t("account", { initial })}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-lime font-heading text-[17px] font-bold text-night"
          >
            {initial}
          </Link>
        ) : onSignIn ? null : (
          <Link
            href="/ienakt"
            className="inline-flex min-h-11 items-center rounded-full bg-mist px-4 text-sm font-bold text-night"
          >
            {t("signIn")}
          </Link>
        )}
      </nav>
    </header>
  );
}
