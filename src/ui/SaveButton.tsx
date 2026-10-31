"use client";

import { track } from "@/ui/analytics/track";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toggleSavedAction } from "@/app/[locale]/velmju-saraksts/actions";
import type { SaveTarget } from "@/app/[locale]/velmju-saraksts/save";
import { buttonClass } from "./Button";
import { NotifyPanel } from "./NotifyPanel";
import { SavedAlertNote } from "./SavedAlertNote";

// "Pieprasīt labāku cenu" (docs/PRICE_NOTIFY_PLAN.md §8.3): one tap saves a
// product or a whole search, asks Trilio for a better price and turns price
// e-mails on; a second tap stops it. Where Trilio does not source (data/
// offers.json "except") the button only promises the price e-mail, with the
// heart. Signed out, the card opens one e-mail field instead of a sign-in
// page. Signed in where Trilio sources, the first tap shows the one sentence
// that also covers Trilio's offers.

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

// A price tag with an arrow down: the request is for a better price, not a wish.
function Tag({ filled }: { filled: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 3h8l10 10-8 8L3 11z" />
      <circle cx="7.5" cy="7.5" r="1.5" fill={filled ? "#fff" : "currentColor"} stroke="none" />
      <path d="M20 14v6M17 17l3 3 3-3" fill="none" stroke={filled ? "#fff" : "currentColor"} />
    </svg>
  );
}

export function SaveButton({
  target,
  saved: initial,
  variant = "card",
  name,
  offers = false,
}: {
  target: SaveTarget;
  saved: boolean;
  /** "card": full-width under a product card; "inline": next to a heading; "icon": heart only. */
  variant?: "card" | "inline" | "icon";
  /** What is saved, for the screen-reader label. */
  name: string;
  /** Trilio sources this category (data/offers.json): the consent sentence covers its offers too. */
  offers?: boolean;
}) {
  const t = useTranslations("wishlist");
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ email: string } | null>(null);
  const [panel, setPanel] = useState<{ email: string | null } | null>(null);
  // Another button for the same item (and the refresh after a tap) brings the server's state.
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setSaved(initial);
  }
  const search = target.kind === "search";
  // A search is a watch for a cheaper option; only a product is a request to a partner.
  const key = `${saved ? "notifying" : "notify"}${search ? "Search" : offers ? "" : "Drop"}` as const;
  const text = t(key);

  function run(next: boolean, consent = false) {
    setSaved(next); // optimistic
    start(async () => {
      const r = await toggleSavedAction(target, next, consent);
      if (!r.ok) {
        setSaved(!next);
        if (r.reason === "auth") setPanel({ email: null });
        else if (r.reason === "consent") setPanel({ email: r.email });
        return;
      }
      setPanel(null);
      if (r.saved) track("save_item", { item: target.kind });
      setNote(r.saved && r.alerts && r.email && variant !== "icon" ? { email: r.email } : null);
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
      aria-expanded={panel ? true : undefined}
      disabled={pending}
      onClick={() => (panel ? setPanel(null) : run(!saved))}
      className={`${className} ${saved ? "text-lime" : ""}`}
      data-notify-button
    >
      {offers && !search && variant !== "icon" ? <Tag filled={saved} /> : <Heart filled={saved} />}
      {variant === "icon" ? null : <span>{text}</span>}
    </button>
  );
  if (!panel && !(note && saved)) return button;
  return (
    <div className="flex w-full flex-col gap-2">
      {button}
      {panel ? (
        <NotifyPanel
          target={target}
          email={panel.email}
          offers={offers && !search}
          onConsent={() => run(true, true)}
          onClose={() => setPanel(null)}
        />
      ) : note && saved ? (
        <SavedAlertNote email={note.email} offers={offers && !search} />
      ) : null}
    </div>
  );
}
