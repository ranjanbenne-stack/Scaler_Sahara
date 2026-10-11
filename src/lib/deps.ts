import { prisma, type Db } from "./db";
import { getConfig, type AppConfig } from "./env";
import { createClassifier, type Classifier } from "./classifier";
import { TelegramApi } from "./telegram/api";
import { ConsoleChannel, TelegramChannel, type NotificationChannel } from "./notifications/channel";

/**
 * Explicit dependency bundle. Production code uses getDeps(); tests build
 * their own with mocked classifier/channel/clock against a real test database.
 */
export interface Deps {
  db: Db;
  config: AppConfig;
  classifier: Classifier;
  channel: NotificationChannel;
  telegram: TelegramApi;
  now: () => Date;
}

let cached: Deps | null = null;

export function getDeps(): Deps {
  if (!cached) {
    const config = getConfig();
    const telegram = new TelegramApi(config.TELEGRAM_BOT_TOKEN, config.TELEGRAM_API_BASE);
    if (config.NOTIFY_CHANNEL === "console" && config.NODE_ENV === "production") {
      throw new Error("NOTIFY_CHANNEL=console is not allowed in production");
    }
    cached = {
      db: prisma,
      config,
      classifier: createClassifier(config),
      channel: config.NOTIFY_CHANNEL === "console" ? new ConsoleChannel() : new TelegramChannel(telegram),
      telegram,
      now: () => new Date(),
    };
  }
  return cached;
}
