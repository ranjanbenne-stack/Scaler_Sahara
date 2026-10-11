/**
 * Thin Telegram Bot API client (no third-party library). The token is only
 * ever placed in the request URL server-side and is redacted from logs.
 */
export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  username?: string;
}

export interface TelegramMessage {
  message_id: number;
  date: number;
  chat: { id: number; type: "private" | "group" | "supergroup" | "channel" };
  from?: TelegramUser;
  text?: string;
}

export interface TelegramUpdatePayload {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  [key: string]: unknown;
}

export class TelegramApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = "TelegramApiError";
  }
}

export interface SendMessageOptions {
  /** Must stay false for emergency messages. Defaults to false. */
  disableNotification?: boolean;
}

export class TelegramApi {
  constructor(
    private readonly token: string,
    private readonly apiBase = "https://api.telegram.org",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get configured(): boolean {
    return this.token.length > 0;
  }

  private async call<T>(method: string, body: Record<string, unknown>, timeoutMs = 15000): Promise<T> {
    if (!this.configured) throw new TelegramApiError("TELEGRAM_BOT_TOKEN is not configured", 0, false);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.apiBase}/bot${this.token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw new TelegramApiError(`Network error calling ${method}: ${(err as Error).name}`, 0, true);
    } finally {
      clearTimeout(timer);
    }
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: T;
      description?: string;
      parameters?: { retry_after?: number };
    };
    if (res.ok && json.ok) return json.result as T;

    const status = res.status;
    // 429 and 5xx are transient. 400 (chat not found) / 403 (bot blocked / never started) are permanent.
    const retryable = status === 429 || status >= 500;
    throw new TelegramApiError(
      `Telegram ${method} failed: ${status} ${json.description ?? ""}`.trim(),
      status,
      retryable,
      json.parameters?.retry_after,
    );
  }

  async sendMessage(chatId: bigint | number, text: string, opts: SendMessageOptions = {}): Promise<{ message_id: number }> {
    return this.call("sendMessage", {
      chat_id: chatId.toString(),
      text,
      disable_notification: opts.disableNotification === true,
      link_preview_options: { is_disabled: true },
    });
  }

  async getUpdates(offset: number | undefined, timeoutSec: number): Promise<TelegramUpdatePayload[]> {
    return this.call(
      "getUpdates",
      { offset, timeout: timeoutSec, allowed_updates: ["message"] },
      (timeoutSec + 10) * 1000,
    );
  }

  async setWebhook(url: string, secretToken: string): Promise<boolean> {
    return this.call("setWebhook", {
      url,
      secret_token: secretToken,
      allowed_updates: ["message"],
      drop_pending_updates: false,
    });
  }

  async deleteWebhook(): Promise<boolean> {
    return this.call("deleteWebhook", { drop_pending_updates: false });
  }
}
