// Runs once when the Next.js server starts.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { schedulerEnabled, startIngestScheduler } = await import("./services/jobs/scheduler");
  if (!schedulerEnabled()) return;
  // The client module, not "@/db": that one is guarded by "server-only" for app code.
  const { createDb } = await import("./db/client");
  startIngestScheduler(createDb().db);
}
