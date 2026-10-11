/**
 * DEV ONLY: send a fake Telegram update to the local webhook, exercising the
 * exact production path (secret check → dedupe → rules → LLM → DB → outbox).
 * Useful when api.telegram.org is unreachable from your network.
 *
 *   npm run bot:simulate -- --from 111 "I need an electrician to check my bedroom fan"
 *   npm run bot:simulate -- --from 111 SOS
 *   npm run bot:simulate -- --from 111 --update-id 42 SOS      # replay the same update id
 *
 * Git Bash on Windows rewrites arguments starting with "/" (e.g. "/link CODE")
 * into file paths — prefix the command with MSYS_NO_PATHCONV=1.
 */
import "./load-env";

const args = process.argv.slice(2);
function take(flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i === -1) return undefined;
  const [, v] = args.splice(i, 2);
  return v;
}
const from = Number(take("--from"));
const updateId = Number(take("--update-id") ?? Date.now() % 2_000_000_000);
const baseUrl = take("--url") ?? process.env.APP_BASE_URL ?? "http://localhost:3000";
const text = args.join(" ");

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("simulate-message is a development tool");
  if (!from || !text) {
    console.error('Usage: npm run bot:simulate -- --from <telegramUserId> "message text"');
    process.exit(1);
  }
  const res = await fetch(`${baseUrl}/api/telegram/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": process.env.TELEGRAM_WEBHOOK_SECRET ?? "" },
    body: JSON.stringify({
      update_id: updateId,
      message: {
        message_id: updateId,
        date: Math.floor(Date.now() / 1000),
        chat: { id: from, type: "private" },
        from: { id: from, is_bot: false, first_name: "Sim" },
        text,
      },
    }),
  });
  console.log(`update ${updateId} → HTTP ${res.status} ${await res.text()}`);
}

void main();
