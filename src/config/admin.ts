// Who may open /admin (docs/ADMIN_AND_OFFERS_PLAN.md §2.1). Addresses are
// configuration: ADMIN_EMAILS, comma-separated. Empty means nobody, so the
// section is off until the variable is set.

export function adminEmails(env: Record<string, string | undefined> = process.env): string[] {
  return (env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^@\s]+@[^@\s]+$/.test(e));
}

export function isAdminEmail(
  email: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!email) return false;
  return adminEmails(env).includes(email.trim().toLowerCase());
}

/** The name an offer e-mail is signed with ("Kristaps no Trilio"). Configuration, not code. */
export function offerSignature(env: Record<string, string | undefined> = process.env): string {
  return (env.OFFERS_SENDER_NAME ?? "").trim() || "Trilio";
}
