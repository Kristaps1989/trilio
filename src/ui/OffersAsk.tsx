"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { usePathname } from "@/i18n/navigation";
import { answerOffersAskAction, offersAskStateAction } from "@/app/[locale]/velmju-saraksts/actions";
import { Button } from "@/ui/Button";

// One question after signing in (owner, 9 Nov 2026), instead of a pre-ticked box: a strip
// under the header, not a pop-up, asked until it is answered once. "Jā" is the consent;
// "Nē" is remembered too. Not on admin, sign-in or offer pages, where it would be in the way.
const QUIET = [/^\/(en\/)?admin/, /^\/(en\/)?ienakt/, /^\/(en\/)?piedavajums\//, /^\/(en\/)?pasutijums\//];

export function OffersAsk() {
  const t = useTranslations("offersAsk");
  const pathname = usePathname();
  const [ask, setAsk] = useState(false);
  const [done, setDone] = useState<null | "yes" | "no">(null);
  const [pending, start] = useTransition();
  const quiet = QUIET.some((r) => r.test(pathname));

  useEffect(() => {
    if (quiet) return;
    let live = true;
    void offersAskStateAction()
      .then((r) => {
        if (live) setAsk(r.ask);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [quiet]);

  if (quiet || (!ask && !done) || done === "no") return null;

  function answer(yes: boolean) {
    start(async () => {
      if (await answerOffersAskAction(yes)) setDone(yes ? "yes" : "no");
    });
  }

  return (
    <section
      aria-label={t("label")}
      data-offers-ask
      className="border-b border-line-25 bg-night px-gutter py-3 text-mist"
    >
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-4 gap-y-2">
        {done === "yes" ? (
          <p role="status" className="text-[15px] font-semibold">
            {t("thanks")}
          </p>
        ) : (
          <>
            <p className="min-w-0 flex-1 text-[15px]">
              <span className="font-semibold">{t("question")}</span>{" "}
              <span className="text-[14px] text-stone">{t("fine")}</span>
            </p>
            <div className="flex gap-2">
              <Button type="button" size="sm" disabled={pending} onClick={() => answer(true)}>
                {t("yes")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => answer(false)}
              >
                {t("no")}
              </Button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
