import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Server-only. Imported by server components, route handlers, jobs and
// scripts; never by client components (the `server-only` guard is applied in
// src/db/index.ts for app code; scripts import this file directly).

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return url;
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
