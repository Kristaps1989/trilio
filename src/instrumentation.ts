// Runs once when the Next.js server starts.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // The image engine's first picture takes seconds (it loads its fonts and wasm): draw one
  // now, so a crawler fetching a post picture after a deploy is not the one who waits.
  void import("./services/social/render")
    .then(({ renderPostJpeg }) => renderPostJpeg({ chip: "", title: "Trilio", lines: [] }, 0, 1, "square"))
    .catch(() => undefined);
  const { schedulerEnabled, startIngestScheduler } = await import("./services/jobs/scheduler");
  if (!schedulerEnabled()) return;
  // On a redeploy Railway sends SIGTERM: a running scrape saves what it has
  // read and closes its run. Next.js exits on its own; the timer is a
  // fallback so this listener can never keep a stopping container alive.
  const { requestStop } = await import("./services/ingestion/shutdown");
  process.once("SIGTERM", () => {
    requestStop();
    setTimeout(() => process.exit(0), 20_000).unref();
  });
  // The client module, not "@/db": that one is guarded by "server-only" for app code.
  const { createDb } = await import("./db/client");
  startIngestScheduler(createDb().db);
}
