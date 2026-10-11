/**
 * Background worker: emergency escalation + notification retries + recovery.
 *   npm run worker
 * Safe to run multiple instances (row claiming uses SKIP LOCKED / optimistic guards).
 */
import "./load-env";
import { getDeps } from "../src/lib/deps";
import { workerTick } from "../src/lib/worker";
import { log } from "../src/lib/logger";

const deps = getDeps();
let running = true;

async function loop() {
  log.info("worker started", { intervalMs: deps.config.WORKER_INTERVAL_MS, ackTimeoutSec: deps.config.ESCALATION_ACK_TIMEOUT_SECONDS });
  while (running) {
    try {
      await workerTick(deps);
    } catch (err) {
      log.error("worker tick failed", { err: String(err) });
    }
    await new Promise((r) => setTimeout(r, deps.config.WORKER_INTERVAL_MS));
  }
  await deps.db.$disconnect();
}

for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => (running = false));
void loop();
