"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// The e-mail's "Apstiprināt" should be the only click (owner, 4 Nov 2026).
// The page still holds the one-button form, so a mail scanner that only
// fetches the link confirms nothing; in a person's browser the form sends
// itself as soon as the page is shown. Without scripts the button stays.

export function AutoConfirm({
  action,
  children,
  busy,
}: {
  action: (formData: FormData) => Promise<void>;
  children: ReactNode;
  busy: string;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const [sending, setSending] = useState(false);
  useEffect(() => {
    let sent = false;
    const send = () => {
      if (sent || document.visibilityState !== "visible") return;
      sent = true;
      setSending(true);
      ref.current?.requestSubmit();
    };
    const timer = window.setTimeout(send, 300);
    document.addEventListener("visibilitychange", send);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", send);
    };
  }, []);
  return (
    <div className="flex flex-col gap-5">
      {sending ? (
        <p role="status" className="text-[17px] font-semibold text-lime">
          {busy}
        </p>
      ) : null}
      <form ref={ref} action={action} className="flex flex-col gap-5" data-auto-confirm>
        {children}
      </form>
    </div>
  );
}
