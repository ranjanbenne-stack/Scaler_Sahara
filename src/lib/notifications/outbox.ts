import { Prisma, type NotificationKind, type NotificationOutbox } from "@prisma/client";
import type { Deps } from "../deps";
import { utcTs } from "../db";
import { EventType, recordEvent } from "../events";
import { log } from "../logger";

type Tx = Prisma.TransactionClient;

const URGENT_KINDS: NotificationKind[] = ["EMERGENCY", "ESCALATION", "ATTENTION"];
const EMERGENCY_KINDS: NotificationKind[] = ["EMERGENCY", "ESCALATION"];

export interface EnqueueInput {
  requestId?: string;
  recipientUserId: string;
  chatId: bigint;
  kind: NotificationKind;
  text: string;
  /** Unique per logical notification; re-enqueueing the same key is a no-op. */
  idempotencyKey: string;
}

/**
 * Insert outbox rows inside the caller's transaction. Duplicate idempotency
 * keys are skipped, so retried intake/escalation never double-notifies.
 * Returns the ids of rows that exist for these keys (new or pre-existing).
 */
export async function enqueueNotifications(tx: Tx, deps: Deps, items: EnqueueInput[]): Promise<string[]> {
  if (items.length === 0) return [];
  const now = deps.now();
  await tx.notificationOutbox.createMany({
    data: items.map((i) => ({
      ...i,
      channel: deps.channel.name,
      maxAttempts: EMERGENCY_KINDS.includes(i.kind) ? deps.config.NOTIFY_EMERGENCY_MAX_ATTEMPTS : deps.config.NOTIFY_MAX_ATTEMPTS,
      nextAttemptAt: now,
      createdAt: now,
    })),
    skipDuplicates: true,
  });
  const rows = await tx.notificationOutbox.findMany({
    where: { idempotencyKey: { in: items.map((i) => i.idempotencyKey) } },
    select: { id: true, requestId: true, kind: true, recipientUserId: true },
  });
  for (const r of rows) {
    if (r.requestId) {
      await recordEvent(tx, r.requestId, EventType.NOTIFICATION_QUEUED, { outboxId: r.id, kind: r.kind, recipientUserId: r.recipientUserId }, undefined, now);
    }
  }
  return rows.map((r) => r.id);
}

export function retryDelayMs(kind: NotificationKind, attempts: number, retryAfterSec?: number): number {
  if (retryAfterSec && retryAfterSec > 0) return retryAfterSec * 1000;
  // Emergency: 5s, 10s, 20s, 40s, capped at 60s. Others: 30s doubling, capped at 30 min.
  return EMERGENCY_KINDS.includes(kind)
    ? Math.min(5000 * 2 ** (attempts - 1), 60_000)
    : Math.min(30_000 * 2 ** (attempts - 1), 30 * 60_000);
}

/**
 * Atomically claim due rows (FOR UPDATE SKIP LOCKED) so concurrent workers and
 * inline dispatch never send the same row twice. Emergency kinds go first.
 */
async function claim(deps: Deps, ids: string[] | undefined, limit: number): Promise<NotificationOutbox[]> {
  const now = deps.now();
  const idFilter = ids && ids.length > 0 ? Prisma.sql`AND id = ANY(${ids}::uuid[])` : Prisma.empty;
  return deps.db.$queryRaw<NotificationOutbox[]>`
    UPDATE notification_outbox SET status = 'SENDING', attempts = attempts + 1, "updatedAt" = ${utcTs(now)}
    WHERE id IN (
      SELECT id FROM notification_outbox
      WHERE status IN ('PENDING', 'FAILED') AND "nextAttemptAt" <= ${utcTs(now)} ${idFilter}
      ORDER BY CASE WHEN kind IN ('EMERGENCY', 'ESCALATION') THEN 0 WHEN kind = 'ATTENTION' THEN 1 ELSE 2 END, "createdAt"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *`;
}

export interface DispatchSummary {
  sent: number;
  failed: number;
  dead: number;
  cancelled: number;
}

/**
 * Deliver due notifications. Called inline right after intake (so SOS alerts go
 * out immediately) and periodically by the worker for retries.
 */
export async function dispatchOutbox(deps: Deps, opts: { ids?: string[]; limit?: number } = {}): Promise<DispatchSummary> {
  const summary: DispatchSummary = { sent: 0, failed: 0, dead: 0, cancelled: 0 };
  const rows = await claim(deps, opts.ids, opts.limit ?? 50);

  for (const row of rows) {
    // Don't send an escalation re-alert for an alert that has since been acknowledged.
    if (row.kind === "ESCALATION" && row.requestId) {
      const req = await deps.db.request.findUnique({ where: { id: row.requestId }, select: { status: true } });
      if (req && req.status !== "ESCALATED") {
        await deps.db.notificationOutbox.update({ where: { id: row.id }, data: { status: "CANCELLED", lastError: "Alert already acknowledged" } });
        summary.cancelled++;
        continue;
      }
    }

    const result = await deps.channel.send({ chatId: row.chatId, text: row.text, urgent: URGENT_KINDS.includes(row.kind) });
    const now = deps.now();

    if (result.ok) {
      await deps.db.$transaction(async (tx) => {
        await tx.notificationOutbox.update({
          where: { id: row.id },
          data: { status: "SENT", sentAt: now, providerMessageId: result.providerMessageId, lastError: null },
        });
        if (row.requestId) {
          await recordEvent(tx, row.requestId, EventType.NOTIFICATION_SENT, { outboxId: row.id, kind: row.kind, recipientUserId: row.recipientUserId, attempt: row.attempts }, undefined, now);
        }
      });
      summary.sent++;
      continue;
    }

    const exhausted = !result.retryable || row.attempts >= row.maxAttempts;
    await deps.db.$transaction(async (tx) => {
      await tx.notificationOutbox.update({
        where: { id: row.id },
        data: exhausted
          ? { status: "DEAD", lastError: result.error }
          : { status: "FAILED", lastError: result.error, nextAttemptAt: new Date(now.getTime() + retryDelayMs(row.kind, row.attempts, result.retryAfterSec)) },
      });
      if (!row.requestId) return;
      await recordEvent(
        tx,
        row.requestId,
        exhausted ? EventType.NOTIFICATION_DEAD : EventType.NOTIFICATION_FAILED,
        { outboxId: row.id, kind: row.kind, recipientUserId: row.recipientUserId, attempt: row.attempts, error: result.error, willRetry: !exhausted },
        undefined,
        now,
      );
      // Fallback: an emergency alert that cannot be delivered triggers immediate escalation
      // to the next responder level instead of waiting for the acknowledgement timeout.
      if (exhausted && EMERGENCY_KINDS.includes(row.kind)) {
        const updated = await tx.request.updateMany({
          where: { id: row.requestId, status: "ESCALATED" },
          data: { nextEscalationAt: now },
        });
        if (updated.count > 0) {
          await recordEvent(tx, row.requestId, EventType.NOTIFICATION_FALLBACK, { reason: "emergency delivery failed; escalating immediately", outboxId: row.id }, undefined, now);
        }
      }
    });
    log.warn("notification delivery failed", { outboxId: row.id, kind: row.kind, attempt: row.attempts, exhausted, error: result.error });
    if (exhausted) summary.dead++;
    else summary.failed++;
  }
  return summary;
}

/** Rows left in SENDING by a crashed process are returned to the retry queue (at-least-once delivery). */
export async function reclaimStuckSending(deps: Deps, olderThanMs = 120_000): Promise<number> {
  const cutoff = new Date(deps.now().getTime() - olderThanMs);
  const res = await deps.db.notificationOutbox.updateMany({
    where: { status: "SENDING", updatedAt: { lt: cutoff } },
    data: { status: "FAILED", lastError: "Reclaimed after interrupted send", nextAttemptAt: deps.now() },
  });
  return res.count;
}
