// Railway billing cron: asks the web service to charge due renewals.
// Needs APP_URL and CRON_SECRET; exits non-zero on failure so Railway shows it.
const base = process.env.APP_URL?.replace(/\/$/, "");
const secret = process.env.CRON_SECRET;
if (!base || !secret) {
  console.error("APP_URL and CRON_SECRET must be set");
  process.exit(2);
}
const res = await fetch(`${base}/api/cron/billing`, {
  method: "POST",
  headers: { authorization: `Bearer ${secret}` },
});
console.log(`billing cron: HTTP ${res.status}`, await res.text());
process.exit(res.ok ? 0 : 1);
