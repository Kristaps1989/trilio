import lv from "@/i18n/messages/lv.json";

// Latvian copy for offer and order e-mails, read from the message file so
// jobs work without a request context (like services/texts.ts).

export const offerCopy = lv.offerEmail;

export function fill(template: string, values: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? `{${k}}`));
}
