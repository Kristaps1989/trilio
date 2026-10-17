import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Server-only. Imported by server components, route handlers, jobs and
// scripts; never by client components (the `server-only` guard is applied in
// src/db/index.ts for app code; scripts import this file directly).

/** Set by `next build` while it evaluates route modules to collect their config. */
const NEXT_BUILD_PHASE = "phase-production-build";

/**
 * Never connected: postgres-js opens a connection on the first query, and no
 * page reads the database at build time (landing pages render on first
 * request). A query during a build fails loudly against this address.
 */
export const BUILD_PLACEHOLDER_URL = "postgres://build:build@127.0.0.1:1/no-database-during-build";

export function connectionString(env: Record<string, string | undefined> = process.env): string {
  const url = env.DATABASE_URL;
  if (url) return url;
  // Railway (and any container build) has no database during `next build`.
  if (env.NEXT_PHASE === NEXT_BUILD_PHASE) return BUILD_PLACEHOLDER_URL;
  throw new Error("DATABASE_URL is not set");
}

declare global {
  var __trilioSql: ReturnType<typeof postgres> | undefined;
}

export function createDb(url = connectionString()) {
  // Reuse the pool across hot reloads in development.
  const client = globalThis.__trilioSql ?? postgres(url, { max: 10, prepare: false });
  if (process.env.NODE_ENV !== "production") globalThis.__trilioSql = client;
  return { db: drizzle(client, { schema }), client };
}

export type Db = ReturnType<typeof createDb>["db"];
