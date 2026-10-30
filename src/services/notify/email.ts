import { Resend } from "resend";

// Transactional email through Resend. Without RESEND_API_KEY nothing is
// sent and the call reports `skipped`, so development and CI never need
// the service. Templates are plain text + minimal HTML, Latvian only.

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  /** e.g. List-Unsubscribe for commercial messages. */
  headers?: Record<string, string>;
};
export type EmailResult =
  { ok: true; id: string | null } | { ok: false; reason: "disabled" | "error"; detail?: string };

export interface EmailSender {
  send(message: EmailMessage): Promise<EmailResult>;
}

export function createEmailSender(env: Record<string, string | undefined> = process.env): EmailSender {
  const key = env.RESEND_API_KEY;
  const from = env.EMAIL_FROM ?? "Trilio <noreply@trilio.lv>";
  if (!key)
    return {
      async send(message) {
        // Dev and CI only: keep what would have been sent, so e2e can follow a confirmation link.
        if (env.ALLOW_INSECURE_TEST_FEATURES === "1") testOutbox().push(message);
        return { ok: false, reason: "disabled" };
      },
    };
  const client = new Resend(key);
  return {
    async send(message) {
      try {
        const res = await client.emails.send({
          from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html ?? textToHtml(message.text),
          ...(message.replyTo ? { replyTo: message.replyTo } : {}),
          ...(message.headers ? { headers: message.headers } : {}),
        });
        if (res.error) return { ok: false, reason: "error", detail: res.error.message };
        return { ok: true, id: res.data?.id ?? null };
      } catch (err) {
        return { ok: false, reason: "error", detail: (err as Error).message };
      }
    },
  };
}

/** Plain text to minimal HTML: paragraphs, line breaks and clickable links. */
export function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map(
      (para) =>
        `<p>${escapeHtml(para)
          .replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}">${u}</a>`)
          .replace(/\n/g, "<br>")}</p>`,
    )
    .join("");
}

export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

/** In-memory sender for tests. */
export function memoryEmailSender(): EmailSender & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
      return { ok: true, id: `mem-${sent.length}` };
    },
  };
}

/** Messages not sent for lack of RESEND_API_KEY while ALLOW_INSECURE_TEST_FEATURES=1 (last 50, one process). */
export function testOutbox(): EmailMessage[] {
  const g = globalThis as { __trilioOutbox?: EmailMessage[] };
  g.__trilioOutbox ??= [];
  if (g.__trilioOutbox.length > 50) g.__trilioOutbox.splice(0, g.__trilioOutbox.length - 50);
  return g.__trilioOutbox;
}
