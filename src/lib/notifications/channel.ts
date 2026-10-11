import { TelegramApi, TelegramApiError } from "../telegram/api";

export interface OutboundMessage {
  chatId: bigint;
  text: string;
  /** Emergency/attention messages. Channels must deliver these with sound/alert enabled. */
  urgent: boolean;
}

export type SendResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; error: string; retryable: boolean; retryAfterSec?: number };

/**
 * Delivery abstraction. Telegram is the only MVP channel; a dedicated mobile
 * app (critical alerts), SMS or voice-call channel can implement this later.
 */
export interface NotificationChannel {
  readonly name: string;
  send(msg: OutboundMessage): Promise<SendResult>;
}

/**
 * Development-only channel for environments where Telegram is unreachable.
 * Prints messages to the server log. getDeps() refuses it in production.
 */
export class ConsoleChannel implements NotificationChannel {
  readonly name = "telegram"; // records stay compatible with the telegram outbox rows
  private seq = 1;
  async send(msg: OutboundMessage): Promise<SendResult> {
    console.log(`\n──── [console channel] to chat ${msg.chatId}${msg.urgent ? " (URGENT)" : ""} ────\n${msg.text}\n────────────────────────────────────────`);
    return { ok: true, providerMessageId: `console-${this.seq++}` };
  }
}

export class TelegramChannel implements NotificationChannel {
  readonly name = "telegram";
  constructor(private readonly api: TelegramApi) {}

  async send(msg: OutboundMessage): Promise<SendResult> {
    try {
      // disable_notification is ALWAYS false. Telegram cannot bypass silent/DND
      // mode — sound depends on the recipient's device and Telegram settings.
      const res = await this.api.sendMessage(msg.chatId, msg.text, { disableNotification: false });
      return { ok: true, providerMessageId: String(res.message_id) };
    } catch (err) {
      if (err instanceof TelegramApiError) {
        return { ok: false, error: err.message, retryable: err.retryable || err.status === 0, retryAfterSec: err.retryAfterSec };
      }
      return { ok: false, error: "Unexpected send error", retryable: true };
    }
  }
}
