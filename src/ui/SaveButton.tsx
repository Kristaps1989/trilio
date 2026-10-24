"use client";

import { useRouter } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { isUiLocale, localizedPath, type UiLocale } from "@/i18n/routing";
import { useState, useTransition } from "react";
import { toggleSavedAction } from "@/app/[locale]/velmju-saraksts/actions";
import type { SaveTarget } from "@/app/[locale]/velmju-saraksts/save";
import { buttonClass } from "./Button";
import { OffersAsk } from "./OffersAsk";
import { SavedAlertNote } from "./SavedAlertNote";

// The heart (owner, 20 Oct 2026): one tap saves a product or a whole search
// to the wishlist, a second tap removes it. Signed out, the tap goes through
// sign-in and the item is saved on the way back.

function Heart({ filled }: { filled: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20.5s-7.5-4.6-9.3-9.4C1.5 7.8 3.7 4.5 7 4.5c2.1 0 3.6 1.2 5 3 1.4-1.8 2.9-3 5-3 3.3 0 5.5 3.3 4.3 6.6C19.5 15.9 12 20.5 12 20.5z" />
    </svg>
  );
}

function signInUrl(target: SaveTarget, locale: UiLocale): string {
  const p = new URLSearchParams();
  if (target.kind === "product") p.set("product", target.productId);
  else {
    p.set("sub", target.subcategoryId);
    p.set("a", target.answersParam);
    p.set("label", target.label);
  }
  p.set("next", `${window.location.pathname}${window.location.search}`);
  return localizedPath(
    `/ienakt?callbackUrl=${encodeURIComponent(`/velmju-saraksts/pievienot?${p.toString()}`)}`,
    locale,
  );
}

export function SaveButton({
  target,
  saved: initial,
  variant = "card",
  name,
}: {
  target: SaveTarget;
  saved: boolean;
  /** "card": full-width under a product card; "inline": next to a heading; "icon": heart only. */
  variant?: "card" | "inline" | "icon";
  /** What is saved, for the screen-reader label. */
  name: string;
}) {
  const t = useTranslations("wishlist");
  const locale = useLocale();
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ alerts: boolean; askOffers: boolean } | null>(null);
  // Another heart for the same item (and the refresh after a tap) brings the server's state.
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setSaved(initial);
  }
  const search = target.kind === "search";
  const text = saved ? (search ? t("searchSaved") : t("saved")) : search ? t("saveSearch") : t("save");

  function toggle() {
    const next = !saved;
    setSaved(next); // optimistic
    start(async () => {
      const r = await toggleSavedAction(target, next);
      if (!r.ok) {
        setSaved(!next);
        if (r.reason === "auth") window.location.href = signInUrl(target, isUiLocale(locale) ? locale : "lv");
        return;
      }
      setNote(variant === "card" && r.saved ? { alerts: r.alerts, askOffers: r.askOffers } : null);
      router.refresh();
    });
  }

  const className =
    variant === "card"
      ? buttonClass({ variant: "card", size: "sm", block: true })
      : variant === "inline"
        ? buttonClass({ variant: "outline", size: "sm" })
        : "inline-flex h-11 w-11 items-center justify-center rounded-full text-lime hover:bg-lime-18";

  const button = (
    <button
      type="button"
      aria-label={variant === "icon" ? `${text}: ${name}` : undefined}
      disabled={pending}
      onClick={toggle}
      className={`${className} ${saved ? "text-lime" : ""}`}
    >
      <Heart filled={saved} />
      {variant === "icon" ? null : <span>{text}</span>}
    </button>
  );
  if (!note || !saved || (!note.alerts && !note.askOffers)) return button;
  return (
    <div className="flex flex-col gap-2">
      {button}
      {note.alerts ? <SavedAlertNote /> : null}
      {note.askOffers ? <OffersAsk /> : null}
    </div>
  );
}
