import lv from "@/i18n/messages/lv.json";
import type { BillingTexts } from "@/services/billing/job";

// Latvian copy for background jobs, read straight from the message file so
// the jobs work from the CLI (no request context) as well as from routes.
// Only simple {placeholder} interpolation is needed here.

function fill(template: string, values: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? `{${k}}`));
}

const email = lv.email;
const radar = lv.radar;

export function radarTexts() {
  return {
    dropSubject: (v: { name: string; price: string }) => fill(email.dropSubject, v),
    dropBody: (v: { name: string; shop: string; price: string; delta: string }) => fill(email.dropBody, v),
    similarSubject: (v: { name: string }) => fill(email.similarSubject, v),
    similarBody: (v: { name: string; price: string; shop: string }) => fill(email.similarBody, v),
    view: email.view,
  };
}

export function billingTexts(): BillingTexts {
  return {
    receiptSubject: (v) => fill(email.receiptSubject, v),
    receiptBody: (v) => fill(email.receiptBody, v),
    failedSubject: email.failedSubject,
    failedBody: (v) => fill(email.failedBody, v),
    expired: radar.expired,
  };
}
