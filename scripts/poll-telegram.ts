/**
 * Local development alternative to the webhook: long-polls getUpdates and
 * feeds each update through the SAME intake pipeline as the webhook.
 *   npm run bot:poll
 * Removes any configured webhook first (Telegram forbids both at once).
 * Do not run this in production — use the webhook.
 */
import "./load-env";
import { getDeps } from "../src/lib/deps";
import { processTelegramUpdate } from "../src/lib/intake/process-update";
import { log } from "../src/lib/logger";

const deps = getDeps();
let running = true;

async function main() {
  if (!deps.telegram.configured) {
    console.error("TELEGRAM_BOT_TOKEN is not set in .env — see README › Telegram bot setup.");
    process.exit(1);
  }
  // Retry until Telegram is reachable (e.g. flaky or firewalled networks) instead of crashing.
  for (;;) {
    try {
      await deps.telegram.deleteWebhook();
      break;
    } catch (err) {
      log.error("cannot reach Telegram (is api.telegram.org blocked on this network?) — retrying in 10s", { err: String(err) });
      await new Promise((r) => setTimeout(r, 10_000));
      if (!running) return;
    }
  }
  log.info("telegram polling started");
  let offset: number | undefined;
  while (running) {
    try {
      const updates = await deps.telegram.getUpdates(offset, 25);
      for (const u of updates) {
        try {
          const res = await processTelegramUpdate(deps, u);
          log.info("update processed", { updateId: u.update_id, outcome: res.outcome, requestId: res.requestId });
          offset = u.update_id + 1;
        } catch (err) {
          // Do not advance the offset: the update will be fetched and retried.
          log.error("update processing failed; will retry", { updateId: u.update_id, err: String(err) });
          await new Promise((r) => setTimeout(r, 2000));
          break;
        }
      }
    } catch (err) {
      log.error("getUpdates failed", { err: String(err) });
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  await deps.db.$disconnect();
}

for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => (running = false));
void main();
