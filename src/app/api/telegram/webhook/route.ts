import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { getDeps } from "@/lib/deps";
import { json } from "@/lib/http";
import { processTelegramUpdate } from "@/lib/intake/process-update";
import { log } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const deps = getDeps();
  if (!deps.config.TELEGRAM_WEBHOOK_SECRET) {
    log.error("webhook called but TELEGRAM_WEBHOOK_SECRET is not configured; rejecting");
    return json({ error: "webhook_not_configured" }, { status: 503 });
  }
  if (!secretMatches(req.headers.get("x-telegram-bot-api-secret-token"), deps.config.TELEGRAM_WEBHOOK_SECRET)) {
    return json({ error: "unauthorized" }, { status: 401 });
  }

  let update: unknown;
  try {
    update = await req.json();
  } catch {
    return json({ error: "bad_request" }, { status: 400 });
  }
  if (!update || typeof update !== "object" || typeof (update as { update_id?: unknown }).update_id !== "number") {
    return json({ ok: true, ignored: true });
  }

  try {
    const res = await processTelegramUpdate(deps, update as Parameters<typeof processTelegramUpdate>[1]);
    log.info("webhook update processed", { updateId: (update as { update_id: number }).update_id, outcome: res.outcome, requestId: res.requestId });
    return json({ ok: true });
  } catch (err) {
    // Non-2xx → Telegram retries; update_id dedupe makes retries safe.
    log.error("webhook processing failed", { err: String(err) });
    return json({ error: "processing_failed" }, { status: 500 });
  }
}
