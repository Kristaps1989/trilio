import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import Resend from "next-auth/providers/resend";
import { db } from "@/db";
import { accounts, sessions, users, verificationTokens } from "@/db/schema";

// Google and email magic link (spec §5.1 step 4; Apple deferred by the owner
// on 18 Oct 2026, see docs/AUTH_SETUP.md). Each provider is on
// only when its credentials exist, so a missing secret never breaks the
// build. Database sessions with httpOnly cookies (Auth.js defaults).
//
// AUTH_DEV_LOGIN=1 adds a passwordless "dev login" for local use and e2e.
// It also needs ALLOW_INSECURE_TEST_FEATURES=1, which is never set on a
// real deployment (NODE_ENV is "production" in CI too, so it is not a guard).

const devLoginEnabled =
  process.env.AUTH_DEV_LOGIN === "1" && process.env.ALLOW_INSECURE_TEST_FEATURES === "1";

function providers(): NextAuthConfig["providers"] {
  const list: NextAuthConfig["providers"] = [];
  if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
    list.push(Google({ clientId: process.env.AUTH_GOOGLE_ID, clientSecret: process.env.AUTH_GOOGLE_SECRET }));
  }
  if (process.env.RESEND_API_KEY) {
    list.push(
      Resend({
        apiKey: process.env.RESEND_API_KEY,
        from: process.env.EMAIL_FROM ?? "Trilio <noreply@trilio.lv>",
        // Single-use token, 15 minutes (spec: magic links are short-lived).
        maxAge: 15 * 60,
      }),
    );
  }
  if (devLoginEnabled) {
    list.push(
      Credentials({
        id: "dev",
        name: "Dev login",
        credentials: { email: { label: "E-pasts", type: "email" } },
        async authorize(credentials) {
          const email = String(credentials?.email ?? "")
            .trim()
            .toLowerCase();
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
          const [existing] = await db.select().from(users).where(eq(users.email, email));
          if (existing) return { id: existing.id, email: existing.email, name: existing.name };
          const [created] = await db.insert(users).values({ email, emailVerified: new Date() }).returning();
          return { id: created!.id, email: created!.email, name: created!.name };
        },
      }),
    );
  }
  return list;
}

export const authConfig: NextAuthConfig = {
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: providers(),
  // Credentials providers cannot use database sessions in Auth.js; JWT keeps one code path for all providers.
  session: { strategy: "jwt", maxAge: 30 * 24 * 3600 },
  pages: { signIn: "/ienakt" },
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.uid) session.user.id = String(token.uid);
      return session;
    },
  },
  trustHost: true,
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

export const enabledProviders = {
  google: !!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET),
  email: !!process.env.RESEND_API_KEY,
  dev: devLoginEnabled,
};

/** The signed-in user's id, or null. */
export async function currentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}
