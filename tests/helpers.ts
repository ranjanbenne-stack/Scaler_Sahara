import { PrismaClient } from "@prisma/client";
import { vi } from "vitest";
import { buildConfig } from "../src/lib/env";
import type { Deps } from "../src/lib/deps";
import type { Classifier, ClassifierResult } from "../src/lib/classifier/types";
import type { NotificationChannel, OutboundMessage, SendResult } from "../src/lib/notifications/channel";
import { TelegramApi, type TelegramUpdatePayload } from "../src/lib/telegram/api";
import type { Classification } from "../src/lib/classifier/schema";

export const db = new PrismaClient();

export async function resetDb() {
  await db.$executeRawUnsafe(`
    TRUNCATE TABLE request_events, notification_outbox, requests, telegram_updates, pairing_codes,
      sessions, telegram_accounts, household_memberships, households, users, rate_limit_buckets
    RESTART IDENTITY CASCADE`);
}

/** Records every outbound message; can be scripted to fail. */
export class MockChannel implements NotificationChannel {
  readonly name = "telegram";
  sent: OutboundMessage[] = [];
  attempts: OutboundMessage[] = [];
  private failures: (SendResult & { ok: false })[] = [];
  failForChat = new Map<string, SendResult & { ok: false }>();
  private nextId = 1000;

  /** Queue the next N sends to fail with the given result. */
  failNext(n: number, result: SendResult & { ok: false } = { ok: false, error: "Telegram sendMessage failed: 502 Bad Gateway", retryable: true }) {
    for (let i = 0; i < n; i++) this.failures.push(result);
  }

  async send(msg: OutboundMessage): Promise<SendResult> {
    this.attempts.push(msg);
    const chatFail = this.failForChat.get(msg.chatId.toString());
    if (chatFail) return chatFail;
    const f = this.failures.shift();
    if (f) return f;
    this.sent.push(msg);
    return { ok: true, providerMessageId: String(this.nextId++) };
  }

  to(chatId: bigint | number) {
    return this.sent.filter((m) => m.chatId === BigInt(chatId));
  }
}

export function mockClassifier(result: Partial<Classification> | ClassifierResult | "throw-json" = {}): Classifier & { classify: ReturnType<typeof vi.fn> } {
  const classify = vi.fn(async (): Promise<ClassifierResult> => {
    if (result === "throw-json") return { ok: false, error: "LLM output was not valid JSON", provider: "mock", model: "mock", latencyMs: 1 };
    if ("ok" in result) return result as ClassifierResult;
    return {
      ok: true,
      provider: "mock",
      model: "mock-1",
      latencyMs: 1,
      classification: {
        category: "home_maintenance",
        service_type: "electrician",
        issue_summary: "Bedroom fan needs inspection",
        urgency: "routine",
        is_emergency: false,
        confidence: 0.95,
        needs_clarification: false,
        clarification_question: null,
        ...(result as Partial<Classification>),
      },
    };
  });
  return { provider: "mock", model: "mock-1", classify } as Classifier & { classify: ReturnType<typeof vi.fn> };
}

export class Clock {
  constructor(public t = new Date("2026-10-11T09:00:00Z")) {}
  now = () => new Date(this.t);
  advance(ms: number) {
    this.t = new Date(this.t.getTime() + ms);
  }
}

export function makeDeps(opts: { classifier?: Classifier; channel?: MockChannel; clock?: Clock; env?: Record<string, string> } = {}) {
  const channel = opts.channel ?? new MockChannel();
  const clock = opts.clock ?? new Clock();
  const config = buildConfig({
    APP_BASE_URL: "http://localhost:3000",
    TELEGRAM_WEBHOOK_SECRET: "test-secret-abcdefgh",
    ESCALATION_ACK_TIMEOUT_SECONDS: "120",
    ESCALATION_MAX_ROUNDS: "3",
    ...(opts.env ?? {}),
  });
  const deps: Deps = {
    db,
    config,
    classifier: opts.classifier ?? mockClassifier(),
    channel,
    telegram: new TelegramApi(""),
    now: clock.now,
  };
  return { deps, channel, clock };
}

export const PARENT_TG = 111_000_111;
export const CHILD_TG = 222_000_222;
export const CHILD2_TG = 333_000_333;
export const STRANGER_TG = 999_000_999;

/** Household with a linked parent and one linked child (level-1 emergency contact). */
export async function seedHousehold(name = "Test Household", ids = { parent: PARENT_TG, child: CHILD_TG }) {
  const household = await db.household.create({ data: { name } });
  const parent = await db.user.create({ data: { displayName: `${name} Parent` } });
  const child = await db.user.create({ data: { displayName: `${name} Child`, email: `child-${ids.child}@example.test` } });
  await db.householdMembership.createMany({
    data: [
      { householdId: household.id, userId: parent.id, role: "PARENT" },
      { householdId: household.id, userId: child.id, role: "CHILD", isEmergencyContact: true, escalationOrder: 1 },
    ],
  });
  await db.telegramAccount.createMany({
    data: [
      { userId: parent.id, telegramUserId: BigInt(ids.parent), chatId: BigInt(ids.parent), botStarted: true },
      { userId: child.id, telegramUserId: BigInt(ids.child), chatId: BigInt(ids.child), botStarted: true },
    ],
  });
  return { household, parent, child };
}

export async function addChild(householdId: string, tgId: number, escalationOrder: number, name = "Second Child") {
  const user = await db.user.create({ data: { displayName: name, email: `child-${tgId}@example.test` } });
  await db.householdMembership.create({ data: { householdId, userId: user.id, role: "CHILD", isEmergencyContact: true, escalationOrder } });
  await db.telegramAccount.create({ data: { userId: user.id, telegramUserId: BigInt(tgId), chatId: BigInt(tgId), botStarted: true } });
  return user;
}

let updateSeq = 5000;
export function tgUpdate(text: string, fromId: number, updateId = updateSeq++): TelegramUpdatePayload {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1_760_000_000,
      chat: { id: fromId, type: "private" },
      from: { id: fromId, is_bot: false, first_name: "Test", username: "spoofable_name" },
      text,
    },
  };
}
