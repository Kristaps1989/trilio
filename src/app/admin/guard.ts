import "server-only";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { isAdminEmail } from "@/config/admin";

// The admin gate (docs/ADMIN_AND_OFFERS_PLAN.md §2.1), checked on the server
// for every admin page and action. Signed out → sign in; signed in as anyone
// else → 404, so the section's existence is not confirmed.

export type Admin = { email: string; userId: string; ip: string | null };

async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

export async function requireAdmin(callbackUrl = "/admin"): Promise<Admin> {
  const session = await auth();
  const email = session?.user?.email;
  if (!session?.user?.id || !email) redirect(`/ienakt?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  if (!isAdminEmail(email)) notFound();
  return { email: email.toLowerCase(), userId: session.user.id, ip: await clientIp() };
}

/** For server actions and routes: null instead of a redirect. */
export async function adminOrNull(): Promise<Admin | null> {
  const session = await auth();
  const email = session?.user?.email;
  if (!session?.user?.id || !email || !isAdminEmail(email)) return null;
  return { email: email.toLowerCase(), userId: session.user.id, ip: await clientIp() };
}
