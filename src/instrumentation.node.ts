export async function registerNode() {
  if (process.env.npm_lifecycle_event === "build") return;
  if ((process.env.NEXT_PHASE ?? "").includes("build")) return;

  const { prepareSqlite } = await import("./lib/db");
  await prepareSqlite();

  // Production on Render is one process: the web server also runs escalation.
  if (process.env.NODE_ENV !== "production") return;
  const { startEmbeddedWorker } = await import("./lib/embedded-worker");
  startEmbeddedWorker();
}
