import type { Deps } from "../deps";
import { EventType, recordEvent } from "../events";
import { enqueueNotifications, dispatchOutbox } from "../notifications/outbox";
import { emergencyLevels } from "../notifications/recipients";
import { emergencyMessage, requestLink, emergencyAckToParentMessage, requestAckToParentMessage } from "../notifications/messages";
import { log } from "../logger";

/**
 * Escalation policy (configurable via env):
 *  - Round 0 (at intake): level-1 emergency contacts are alerted.
 *  - Every ESCALATION_ACK_TIMEOUT_SECONDS without acknowledgement, the next
 *    round alerts the next responder level. Once levels are exhausted, all
 *    responders are re-alerted each round if ESCALATION_REPEAT_LAST_LEVEL=true.
 *  - After ESCALATION_MAX_ROUNDS the worker stops re-alerting, records
 *    ESCALATION_EXHAUSTED, and the alert STAYS unacknowledged on the dashboard.
 *  - Nothing here ever marks an emergency resolved; only a human acknowledgement does.
 */
export async function runEscalations(deps: Deps): Promise<number> {
  const now = deps.now();
  const due = await deps.db.request.findMany({
    where: { isEmergency: true, status: "ESCALATED", nextEscalationAt: { lte: now } },
    include: { parent: true, household: true },
    orderBy: { nextEscalationAt: "asc" },
    take: 50,
  });

  let escalated = 0;
  for (const req of due) {
    const round = req.escalationLevel + 1;
    const ids = await deps.db.$transaction(async (tx) => {
      // Optimistic guard: only one worker may advance a given round.
      const advanced = await tx.request.updateMany({
        where: { id: req.id, status: "ESCALATED", escalationLevel: req.escalationLevel },
        data: {
          escalationLevel: round,
          nextEscalationAt: round >= deps.config.ESCALATION_MAX_ROUNDS ? null : new Date(now.getTime() + deps.config.ESCALATION_ACK_TIMEOUT_SECONDS * 1000),
        },
      });
      if (advanced.count === 0) return null;

      const levels = await emergencyLevels(tx, req.householdId);
      let targets = levels[round] ?? null; // next configured responder level
      let mode = "next_level";
      if (!targets) {
        if (deps.config.ESCALATION_REPEAT_LAST_LEVEL && levels.length > 0) {
          targets = levels.flat();
          mode = "repeat_all";
        } else {
          targets = [];
          mode = "no_more_responders";
        }
      }

      await recordEvent(tx, req.id, EventType.ESCALATION_ROUND, { round, mode, recipients: targets.map((t) => t.userId) }, undefined, now);
      if (round >= deps.config.ESCALATION_MAX_ROUNDS) {
        await recordEvent(tx, req.id, EventType.ESCALATION_EXHAUSTED, { rounds: round, note: "Automatic re-alerts stopped; alert remains unacknowledged" }, undefined, now);
      }
      if (targets.length === 0) return [];

      const summary = {
        reference: req.reference,
        category: req.category,
        serviceType: null,
        issueSummary: req.issueSummary,
        urgency: "emergency",
        createdAt: req.createdAt,
        parentName: req.parent.displayName,
        householdName: req.household.name,
      };
      const link = requestLink(deps.config.APP_BASE_URL, req.id);
      return enqueueNotifications(
        tx,
        deps,
        targets.map((t) => ({
          requestId: req.id,
          recipientUserId: t.userId,
          chatId: t.chatId,
          kind: "ESCALATION" as const,
          text: emergencyMessage(summary, link, { isSos: req.detectionSource === "RULE_SOS", escalationRound: round }),
          idempotencyKey: `escalation:${req.id}:${round}:${t.userId}`,
        })),
      );
    });
    if (ids === null) continue;
    escalated++;
    log.info("emergency escalated", { requestId: req.id, round });
    if (ids.length > 0) await dispatchOutbox(deps, { ids });
  }
  return escalated;
}

export type AckResult =
  | { ok: true; alreadyAcknowledged: boolean; acknowledgedAt: Date; acknowledgedById: string }
  | { ok: false; reason: "not_found" | "not_open" };

const OPENABLE = ["RECEIVED", "NEEDS_REVIEW"] as const;

/**
 * Acknowledge a request. Emergencies must still be ESCALATED; ordinary tickets
 * can be RECEIVED or NEEDS_REVIEW. Caller must already have verified the user
 * is an authorized CHILD member of the request's household.
 */
export async function acknowledgeEmergency(deps: Deps, requestId: string, userId: string): Promise<AckResult> {
  const now = deps.now();
  const out = await deps.db.$transaction(async (tx) => {
    const req = await tx.request.findUnique({ where: { id: requestId }, include: { parent: { include: { telegram: true } } } });
    if (!req) return { ok: false, reason: "not_found" } as const;
    const open = req.isEmergency ? req.status === "ESCALATED" : (OPENABLE as readonly string[]).includes(req.status);
    if (!open) {
      if (req.acknowledgedAt && req.acknowledgedById) {
        return { ok: true, alreadyAcknowledged: true, acknowledgedAt: req.acknowledgedAt, acknowledgedById: req.acknowledgedById, notify: [] as string[] } as const;
      }
      return { ok: false, reason: "not_open" } as const;
    }
    const updated = await tx.request.updateMany({
      where: { id: requestId, status: req.isEmergency ? "ESCALATED" : { in: [...OPENABLE] } },
      data: { status: "ACKNOWLEDGED", acknowledgedAt: now, acknowledgedById: userId, nextEscalationAt: null },
    });
    if (updated.count === 0) {
      const fresh = await tx.request.findUniqueOrThrow({ where: { id: requestId } });
      return { ok: true, alreadyAcknowledged: true, acknowledgedAt: fresh.acknowledgedAt ?? now, acknowledgedById: fresh.acknowledgedById ?? userId, notify: [] as string[] } as const;
    }
    const responder = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    await recordEvent(tx, requestId, EventType.ACKNOWLEDGED, { by: userId, byName: responder.displayName, at: now.toISOString() }, userId, now);
    // Cancel queued, unsent escalation re-alerts.
    await tx.notificationOutbox.updateMany({
      where: { requestId, kind: "ESCALATION", status: { in: ["PENDING", "FAILED"] } },
      data: { status: "CANCELLED", lastError: "Alert acknowledged" },
    });
    let notify: string[] = [];
    if (req.parent.telegram?.botStarted) {
      notify = await enqueueNotifications(tx, deps, [
        {
          requestId,
          recipientUserId: req.parentUserId,
          chatId: req.parent.telegram.chatId,
          kind: "PARENT_ACK",
          text: req.isEmergency ? emergencyAckToParentMessage(responder.displayName) : requestAckToParentMessage(responder.displayName, req.reference),
          idempotencyKey: `ack:${requestId}`,
        },
      ]);
    }
    return { ok: true, alreadyAcknowledged: false, acknowledgedAt: now, acknowledgedById: userId, notify } as const;
  });

  if (!out.ok) return out;
  if (out.notify.length > 0) await dispatchOutbox(deps, { ids: out.notify }).catch(() => {});
  return { ok: true, alreadyAcknowledged: out.alreadyAcknowledged, acknowledgedAt: out.acknowledgedAt, acknowledgedById: out.acknowledgedById };
}
