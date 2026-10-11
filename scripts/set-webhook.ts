/**
 * Registers the production webhook with Telegram, including the secret token.
 *   npm run bot:set-webhook            # uses APP_BASE_URL
 *   npm run bot:set-webhook -- https://my-tunnel.example.com
 */
import "./load-env";
import { getDeps } from "../src/lib/deps";

async function main() {
  const deps = getDeps();
  const base = (process.argv[2] ?? deps.config.APP_BASE_URL).replace(/\/$/, "");
  if (!base.startsWith("https://")) throw new Error("Telegram webhooks require an https:// URL");
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(deps.config.TELEGRAM_WEBHOOK_SECRET)) {
    throw new Error("TELEGRAM_WEBHOOK_SECRET must be 16–256 chars of A-Z a-z 0-9 _ -");
  }
  await deps.telegram.setWebhook(`${base}/api/telegram/webhook`, deps.config.TELEGRAM_WEBHOOK_SECRET);
  console.log(`Webhook set to ${base}/api/telegram/webhook`);
  await deps.db.$disconnect();
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
