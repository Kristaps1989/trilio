"use client";

import { useState } from "react";
import type { EmailMessage } from "@/services/notify/email";

// The e-mail exactly as the reader gets it: the HTML in a frame, the subject
// above it and the plain-text part folded below. The HTML is Trilio's own,
// every value escaped and no scripts, and the page's CSP covers the frame too.

type Props = {
  message: Pick<EmailMessage, "to" | "subject" | "text" | "html">;
  labels: { to: string; frame: string; text: string };
};

export function EmailPreview({ message, labels }: Props) {
  const [height, setHeight] = useState(900);
  return (
    <div
      className="rounded-panel-lg bg-white p-5 text-night [overflow-wrap:anywhere]"
      data-testid="email-preview"
    >
      <p className="text-sm text-muted">{labels.to}</p>
      <p className="mt-1 font-bold" data-testid="email-subject">
        {message.subject}
      </p>
      {message.html ? (
        <iframe
          title={labels.frame}
          srcDoc={message.html}
          className="mt-3 w-full rounded-control border-0"
          style={{ height }}
          onLoad={(e) => {
            const doc = e.currentTarget.contentDocument;
            if (doc?.body) setHeight(doc.documentElement.scrollHeight + 8);
          }}
        />
      ) : null}
      <details className="mt-3 text-[15px]">
        <summary className="min-h-11 cursor-pointer py-2 font-semibold">{labels.text}</summary>
        <div className="flex flex-col gap-3 leading-relaxed whitespace-pre-line" data-testid="email-text">
          {message.text.split("\n\n").map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      </details>
    </div>
  );
}
