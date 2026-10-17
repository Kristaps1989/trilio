import { Resend } from "resend";

// Transactional email through Resend. Without RESEND_API_KEY nothing is
// sent and the call reports `skipped`, so development and CI never need
// the service. Templates are plain text + minimal HTML, Latvian only.

export type EmailMessage = { to: string; subject: string; text: string; html?: string };
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
      async send() {
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
          html: message.html ?? `<p>${escapeHtml(message.text).replace(/\n/g, "<br>")}</p>`,
        });
        if (res.error) return { ok: false, reason: "error", detail: res.error.message };
        return { ok: true, id: res.data?.id ?? null };
      } catch (err) {
        return { ok: false, reason: "error", detail: (err as Error).message };
      }
    },
  };
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
