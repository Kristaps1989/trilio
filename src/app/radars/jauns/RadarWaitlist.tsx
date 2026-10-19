"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { ButtonLink, Button } from "@/ui/Button";
import { InfoBox } from "@/ui/layout";

// Payments not switched on yet: the radar cannot start, so the shopper leaves
// an e-mail (pre-filled from the account) and hears when it can.

export function RadarWaitlist({ email, note }: { email: string; note: string }) {
  const t = useTranslations("radar");
  const id = useId();
  const [value, setValue] = useState(email);
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const res = await fetch("/api/waitlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: value, freeText: note.slice(0, 300), source: "radar_waitlist" }),
    }).catch(() => null);
    setState(res?.ok ? "done" : "error");
  }

  if (state === "done") {
    return (
      <div className="flex flex-col gap-3">
        <InfoBox>
          <span role="status">{t("waitlistDone", { email: value })}</span>
        </InfoBox>
        <div>
          <ButtonLink href="/izvelies" variant="outline">
            {t("backToResults")}
          </ButtonLink>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <InfoBox>{t("paymentsOff")}</InfoBox>
      <label htmlFor={id} className="text-sm text-stone">
        {t("waitlistEmail")}
      </label>
      <input
        id={id}
        type="email"
        required
        autoComplete="email"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="min-h-11 rounded-control border-[1.5px] border-mist-32 bg-transparent px-3 text-lg text-mist"
      />
      {state === "error" ? (
        <p role="alert" className="text-[15px] text-warning">
          {t("waitlistError")}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={state === "sending"}>
          {t("waitlistJoin")}
        </Button>
        <ButtonLink href="/izvelies" variant="outline">
          {t("backToResults")}
        </ButtonLink>
      </div>
    </form>
  );
}
