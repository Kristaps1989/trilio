"use client";

import { Link } from "@/i18n/navigation";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { encodeState } from "@/domain/flow/state";
import { Button, ButtonLink } from "@/ui/Button";
import { InfoBox } from "@/ui/layout";

type RouteResponse = {
  subcategoryId: string | null;
  groupId: string | null;
  prefilled: Record<string, unknown>;
  outOfScope: boolean;
};

export type FreeTextOutcome = "idle" | "out_of_scope" | "not_understood" | "error" | "thanks";

export function FreeTextForm({
  initialText = "",
  initialOutcome = "idle",
}: {
  initialText?: string;
  initialOutcome?: FreeTextOutcome;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<FreeTextOutcome>(initialOutcome);
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setState("idle");
    try {
      const res = await fetch("/api/free-text", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as RouteResponse;
      if (data.subcategoryId && data.groupId) {
        const a = encodeState({ answers: data.prefilled as never, trailing: {} });
        router.push(`/izvelies/${data.groupId}/${data.subcategoryId}?a=${a}`);
        return;
      }
      setState(data.outOfScope ? "out_of_scope" : "not_understood");
    } catch {
      setState("error");
    } finally {
      setBusy(false);
    }
  }

  async function joinWaitlist(e: React.FormEvent) {
    e.preventDefault();
    setEmailError(null);
    const res = await fetch("/api/waitlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, freeText: text }),
    });
    if (res.status === 400) {
      setEmailError(t("waitlist.invalidEmail"));
      return;
    }
    setState(res.ok ? "thanks" : "error");
  }

  const fieldClass =
    "w-full rounded-control border-[1.5px] border-line-40 bg-white-5 px-4 py-3 text-[17px] text-mist placeholder:text-stone";

  return (
    <div className="mt-1 flex flex-col gap-6">
      <form method="get" action="/cits" onSubmit={submit} className="flex flex-col gap-3">
        <label htmlFor="free-text" className="text-[15px] font-semibold text-mist">
          {t("freeText.label")}
        </label>
        <textarea
          id="free-text"
          name="text"
          required
          maxLength={300}
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className={fieldClass}
        />
        <p className="text-sm text-stone">{t("freeText.aiNote")}</p>
        <div className="flex flex-wrap items-center gap-[14px]">
          <Button type="submit" disabled={busy}>
            {busy ? t("freeText.searching") : t("freeText.submit")}
          </Button>
          <ButtonLink href="/izvelies" variant="link">
            {t("freeText.chooseFromList")}
          </ButtonLink>
        </div>
      </form>

      {state === "not_understood" ? (
        <div className="flex flex-col gap-3" role="status">
          <InfoBox>{t("freeText.notUnderstood")}</InfoBox>
          <div>
            <ButtonLink href="/izvelies" variant="outline">
              {t("freeText.chooseFromList")}
            </ButtonLink>
          </div>
        </div>
      ) : null}

      {state === "out_of_scope" ? (
        <form onSubmit={joinWaitlist} className="flex flex-col gap-[14px]" role="status">
          <p className="font-heading text-[22px] font-semibold leading-tight text-mist">
            {t("waitlist.outOfScope")}
          </p>
          <div className="flex max-w-[560px] flex-wrap items-end gap-[14px]">
            <label htmlFor="waitlist-email" className="sr-only">
              {t("waitlist.emailLabel")}
            </label>
            <input
              id="waitlist-email"
              type="email"
              name="email"
              required
              inputMode="email"
              autoComplete="email"
              placeholder={t("waitlist.emailPlaceholder")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="min-w-0 flex-[1_1_240px] border-0 border-b-2 border-lime bg-transparent py-2 font-heading text-[clamp(20px,3vw,26px)] font-semibold text-mist outline-none placeholder:text-stone/60"
              aria-invalid={!!emailError}
            />
            <Button type="submit">{t("waitlist.notify")}</Button>
          </div>
          {emailError ? <p className="text-[15px] text-warning">{emailError}</p> : null}
          <p className="text-sm text-stone">
            {t.rich("waitlist.consent", {
              privacy: (chunks) => (
                <Link href="/privatums" className="text-mist underline">
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </form>
      ) : null}

      {state === "thanks" ? (
        <div role="status">
          <InfoBox>{t("waitlist.thanks")}</InfoBox>
        </div>
      ) : null}
      {state === "error" ? (
        <p className="text-base text-warning" role="alert">
          {t("freeText.error")}
        </p>
      ) : null}
    </div>
  );
}
