"use client";

import { Link } from "@/i18n/navigation";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, useSyncExternalStore } from "react";
import { clickLabel, eventFromDataset, pageInfo } from "@/domain/analytics/page";
import { adsConversionFor, type AdsTag } from "@/config/analytics";
import { Button } from "@/ui/Button";
import {
  CONSENT_CHANGED,
  CONSENT_OPEN,
  type Consent,
  deleteAnalyticsCookies,
  readConsent,
  writeConsent,
} from "./consent";
import { TRACK_EVENT, type TrackDetail } from "./track";

// Google Analytics 4 and the Google Ads tag, opt-in only (docs/ANALYTICS.md).
// Nothing is loaded and no cookie is set until the visitor accepts in the
// banner. GA4 events are sent to GA4 only; Google Ads gets its page view and
// the two conversions (a shop click, a save) when their labels are set. Page views carry
// the site section and subcategory, never the query string. Every button and
// link click is sent as `ui_click`; elements with `data-ga-event` send their
// own event (answers, offer clicks).

type Gtag = (...args: unknown[]) => void;
declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(CONSENT_CHANGED, onChange);
  return () => window.removeEventListener(CONSENT_CHANGED, onChange);
}

function loadGtag(measurementId: string | null, ads: AdsTag | null) {
  if (window.gtag) return;
  const first = measurementId ?? ads?.id;
  if (!first) return;
  window.dataLayer = window.dataLayer ?? [];
  window.gtag = function gtag() {
    // gtag.js expects the `arguments` object itself, not an array.
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  // Consent Mode v2, basic: nothing loads before "Atļaut". The visitor's yes covers
  // statistics and measuring which ads brought them (docs/GROWTH_PLAN.md §5, Phase 0);
  // ad personalisation (remarketing lists) stays denied.
  window.gtag("consent", "default", {
    analytics_storage: "granted",
    ad_storage: "granted",
    ad_user_data: "granted",
    ad_personalization: "denied",
  });
  window.gtag("js", new Date());
  if (measurementId)
    window.gtag("config", measurementId, {
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
    });
  if (ads) window.gtag("config", ads.id, { allow_ad_personalization_signals: false });
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(first)}`;
  document.head.appendChild(script);
}

const CLICKABLE = "a, button, [role=button], [role=radio], [role=checkbox]";

function onDocumentClick(event: MouseEvent, measurementId: string | null, ads: AdsTag | null) {
  const el = (event.target as Element | null)?.closest<HTMLElement>(CLICKABLE);
  if (!el || !window.gtag || el.closest("[data-ga-ignore]")) return;
  const page = pageInfo(location.pathname, location.search);
  const base = { section: page.section, subcategory: page.subcategory };
  const custom = eventFromDataset(el.dataset);
  if (custom) {
    const conversion = adsConversionFor(custom.event, ads);
    if (conversion) window.gtag("event", "conversion", { send_to: conversion });
    if (measurementId)
      window.gtag("event", custom.event, { ...base, ...custom.params, send_to: measurementId });
    return;
  }
  if (!measurementId) return;
  const params: Record<string, string | undefined> = {
    ...base,
    label: clickLabel(el.innerText, el.dataset.gaLabel ?? el.getAttribute("aria-label")),
    element: el.getAttribute("role") ?? el.tagName.toLowerCase(),
  };
  if (el instanceof HTMLAnchorElement && el.href) {
    const url = new URL(el.href, location.href);
    params.link = url.origin === location.origin ? url.pathname : url.hostname;
  }
  window.gtag("event", "ui_click", { ...params, send_to: measurementId });
}

export function Analytics({ measurementId, ads }: { measurementId: string | null; ads: AdsTag | null }) {
  const t = useTranslations("consent");
  const consent = useSyncExternalStore<Consent | "pending">(
    subscribe,
    () => readConsent(),
    () => "pending",
  );
  const [reopened, setReopened] = useState(false);
  const pathname = usePathname();
  const search = useSearchParams().toString();

  useEffect(() => {
    const open = () => setReopened(true);
    window.addEventListener(CONSENT_OPEN, open);
    return () => window.removeEventListener(CONSENT_OPEN, open);
  }, []);

  useEffect(() => {
    if (consent !== "granted") return;
    loadGtag(measurementId, ads);
    const onClick = (e: MouseEvent) => onDocumentClick(e, measurementId, ads);
    const onTrack = (e: Event) => {
      const { event, params } = (e as CustomEvent<TrackDetail>).detail;
      if (!window.gtag) return;
      const conversion = adsConversionFor(event, ads);
      if (conversion) window.gtag("event", "conversion", { send_to: conversion });
      if (measurementId) {
        const page = pageInfo(location.pathname, location.search);
        window.gtag("event", event, {
          section: page.section,
          subcategory: page.subcategory,
          ...params,
          send_to: measurementId,
        });
      }
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener(TRACK_EVENT, onTrack);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener(TRACK_EVENT, onTrack);
    };
  }, [consent, measurementId, ads]);

  useEffect(() => {
    if (consent !== "granted" || !window.gtag) return;
    const page = pageInfo(pathname, search ? `?${search}` : "");
    // Google Ads counts its own page view from its config; this one is for GA4.
    if (!measurementId) return;
    window.gtag("event", "page_view", {
      send_to: measurementId,
      page_location: `${location.origin}${page.path}`,
      page_path: page.path,
      page_title: document.title,
      content_group: page.section,
      section: page.section,
      subcategory: page.subcategory,
    });
  }, [consent, pathname, search, measurementId]);

  const choose = (value: "granted" | "denied") => {
    const wasGranted = consent === "granted";
    writeConsent(value);
    setReopened(false);
    if (value === "denied" && wasGranted) {
      // Withdrawing consent: remove the Google cookies and drop the loaded script.
      deleteAnalyticsCookies();
      location.reload();
    }
  };

  if (consent === "pending" || (consent !== "unset" && !reopened)) return null;

  return (
    <section
      aria-label={t("title")}
      data-ga-ignore=""
      className="fixed inset-x-0 bottom-0 z-50 border-t border-line-25 bg-night px-gutter pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[0_-12px_32px_rgb(0_0_0/0.35)]"
    >
      <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex max-w-[720px] flex-col gap-1">
          <h2 className="font-heading text-lg font-semibold text-mist">{t("title")}</h2>
          <p className="text-[15px] leading-normal text-stone">
            {t.rich("text", {
              policy: (chunks) => (
                <Link href="/sikdatnes" className="text-mist underline">
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </div>
        {/* Equal buttons: refusing is as easy as accepting (CLAUDE.md rule 4). */}
        <div className="grid shrink-0 grid-cols-2 gap-3 md:flex">
          <Button variant="outline" onClick={() => choose("denied")}>
            {t("reject")}
          </Button>
          <Button variant="outline" onClick={() => choose("granted")}>
            {t("accept")}
          </Button>
        </div>
      </div>
    </section>
  );
}

/** Footer button that reopens the banner so the choice can be changed. */
export function ConsentSettingsButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(CONSENT_OPEN))}
      className="flex min-h-11 items-center text-[13px] text-stone underline underline-offset-2"
    >
      {label}
    </button>
  );
}
