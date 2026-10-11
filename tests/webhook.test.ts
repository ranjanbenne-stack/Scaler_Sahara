import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PARENT_TG, db, makeDeps, resetDb, seedHousehold, tgUpdate } from "./helpers";

const holder = vi.hoisted(() => ({ deps: null as unknown }));
vi.mock("@/lib/deps", () => ({ getDeps: () => holder.deps }));

const { POST } = await import("../src/app/api/telegram/webhook/route");

function webhookRequest(body: unknown, secret?: string) {
  return new NextRequest("http://localhost:3000/api/telegram/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", ...(secret ? { "x-telegram-bot-api-secret-token": secret } : {}) },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  await resetDb();
  holder.deps = makeDeps().deps;
});

describe("Telegram webhook endpoint", () => {
  it("rejects requests without the correct secret token", async () => {
    await seedHousehold();
    expect((await POST(webhookRequest(tgUpdate("SOS", PARENT_TG)))).status).toBe(401);
    expect((await POST(webhookRequest(tgUpdate("SOS", PARENT_TG), "wrong-secret-value"))).status).toBe(401);
    expect(await db.request.count()).toBe(0);
  });

  it("accepts a valid update and is idempotent across Telegram retries", async () => {
    await seedHousehold();
    const update = tgUpdate("SOS", PARENT_TG, 424242);
    expect((await POST(webhookRequest(update, "test-secret-abcdefgh"))).status).toBe(200);
    expect((await POST(webhookRequest(update, "test-secret-abcdefgh"))).status).toBe(200);
    expect(await db.request.count()).toBe(1);
  });

  it("refuses to run when no webhook secret is configured", async () => {
    holder.deps = makeDeps({ env: { TELEGRAM_WEBHOOK_SECRET: "" } }).deps;
    expect((await POST(webhookRequest(tgUpdate("SOS", PARENT_TG), "anything"))).status).toBe(503);
  });
});
