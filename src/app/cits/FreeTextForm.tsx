"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { encodeState } from "@/domain/flow/state";
import { PrimaryButton, PrimaryLink } from "@/ui/PrimaryButton";

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

  return (
    <div className="mt-6 flex flex-col gap-6">
      <form method="get" action="/cits" onSubmit={submit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-2 text-base font-semibold text-mist">
          <span>{t("freeText.label")}</span>
          <textarea
            name="text"
            required
            maxLength={300}
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full rounded-[14px] border-[1.5px] border-mist-32 bg-white-5 px-4 py-3 text-[17px] text-mist"
          />
        </label>
        <PrimaryButton type="submit" disabled={busy}>
          {busy ? t("freeText.searching") : t("freeText.submit")}
        </PrimaryButton>
      </form>

      {state === "not_understood" ? (
        <div className="flex flex-col gap-3" role="status">
          <p className="text-base text-mist">{t("freeText.notUnderstood")}</p>
          <PrimaryLink href="/izvelies" variant="secondary">
            {t("freeText.chooseFromList")}
          </PrimaryLink>
        </div>
      ) : null}

      {state === "out_of_scope" ? (
        <form onSubmit={joinWaitlist} className="flex flex-col gap-3" role="status">
          <p className="text-base font-semibold text-mist">{t("waitlist.outOfScope")}</p>
          <label className="flex flex-col gap-2 text-base font-semibold text-mist">
            <span>{t("waitlist.emailLabel")}</span>
            <input
              type="email"
              name="email"
              required
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="min-h-14 w-full rounded-[14px] border-[1.5px] border-mist-32 bg-white-5 px-4 text-[17px] text-mist"
              aria-invalid={!!emailError}
            />
          </label>
          {emailError ? <p className="text-sm text-warning">{emailError}</p> : null}
          <PrimaryButton type="submit">{t("waitlist.notify")}</PrimaryButton>
          <Link href="/izvelies" className="min-h-11 text-center text-base font-semibold text-lime">
            {t("freeText.chooseFromList")}
          </Link>
        </form>
      ) : null}

      {state === "thanks" ? (
        <p className="text-base text-mist" role="status">
          {t("waitlist.thanks")}
        </p>
      ) : null}
      {state === "error" ? (
        <p className="text-base text-warning" role="alert">
          {t("freeText.error")}
        </p>
      ) : null}
    </div>
  );
}
