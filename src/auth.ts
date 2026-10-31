import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import Resend from "next-auth/providers/resend";
import { db } from "@/db";
import { accounts, sessions, users, verificationTokens } from "@/db/schema";
import { isAdminEmail } from "@/config/admin";
import { rememberedLanguage } from "@/i18n/path";
import { notifySignIn } from "@/services/notify/requests";
import { offerSignIn } from "@/services/offers/offers";

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
  // Sign-in through a personal offer link (docs/ADMIN_AND_OFFERS_PLAN.md §5.3): the link was
  // e-mailed to the account's address, so while the offer is open it proves what a magic link proves.
  list.push(
    Credentials({
      id: "offer",
      name: "Offer link",
      credentials: { token: { label: "Token", type: "text" } },
      async authorize(credentials) {
        return offerSignIn(db, String(credentials?.token ?? ""));
      },
    }),
  );
  // "Pieprasīt labāku cenu" without an account (docs/PRICE_NOTIFY_PLAN.md): the
  // confirmation link was e-mailed to that address, so right after the click it signs in, once.
  list.push(
    Credentials({
      id: "notify",
      name: "Notify link",
      credentials: { token: { label: "Token", type: "text" } },
      async authorize(credentials) {
        return notifySignIn(db, String(credentials?.token ?? ""));
      },
    }),
  );
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
          const [created] = await db
            .insert(users)
            .values({ email, emailVerified: new Date(), locale: await rememberedLanguage() })
            .returning();
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
  events: {
    // A new account writes to its owner in the language they signed up in (src/i18n/path.ts).
    async createUser({ user }) {
      const locale = await rememberedLanguage();
      if (user.id && locale !== "lv") await db.update(users).set({ locale }).where(eq(users.id, user.id));
    },
  },
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.uid) session.user.id = String(token.uid);
      // Only drives the header's "Admin" link; every admin page and action checks again on the server.
      (session.user as { isAdmin?: boolean }).isAdmin = isAdminEmail(session.user.email);
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
