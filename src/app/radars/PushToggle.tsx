"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/ui/Button";

// Registers the service worker and subscribes this device to Web Push.
// Shown only when the user chose push and the server has a VAPID key.

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function PushToggle({ publicKey }: { publicKey: string }) {
  const t = useTranslations("radar");
  const [state, setState] = useState<"unknown" | "unsupported" | "off" | "on">("unknown");

  useEffect(() => {
    // Everything async so no state is set synchronously inside the effect.
    Promise.resolve()
      .then(() => {
        if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("unsupported");
        return navigator.serviceWorker.register("/sw.js");
      })
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setState(sub ? "on" : "off"))
      .catch(() => setState("unsupported"));
  }, []);

  async function enable() {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      setState(res.ok ? "on" : "off");
    } catch {
      setState("off");
    }
  }

  if (state === "unknown") return null;
  if (state === "unsupported") return <p className="text-sm text-stone">{t("pushUnsupported")}</p>;
  if (state === "on") return <p className="text-sm text-lime">{t("pushEnabled")}</p>;
  return (
    <div>
      <Button variant="outline" size="sm" onClick={enable}>
        {t("enablePush")}
      </Button>
    </div>
  );
}
