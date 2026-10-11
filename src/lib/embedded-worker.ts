import { getDeps } from "./deps";
import { prepareSqlite } from "./db";
import { workerTick } from "./worker";
import { log } from "./logger";

const globalForWorker = globalThis as unknown as { saharaWorker?: boolean };

/**
 * Runs escalation and notification retries inside the web process.
 * One Render service then owns both the dashboard and the worker, and both
 * share the same SQLite file.
 */
export function startEmbeddedWorker(): void {
  if (globalForWorker.saharaWorker) return;
  globalForWorker.saharaWorker = true;

  const deps = getDeps();
  let running = true;
  log.info("embedded worker started", {
    intervalMs: deps.config.WORKER_INTERVAL_MS,
    ackTimeoutSec: deps.config.ESCALATION_ACK_TIMEOUT_SECONDS,
  });

  const loop = async () => {
    while (running) {
      try {
        await prepareSqlite(deps.db);
        await workerTick(deps);
      } catch (err) {
        log.error("worker tick failed", { err: String(err) });
      }
      await new Promise((r) => setTimeout(r, deps.config.WORKER_INTERVAL_MS));
    }
  };

  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      running = false;
    });
  }
  void loop();
}
