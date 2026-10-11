import type { Prisma } from "@prisma/client";

export const EventType = {
  RECEIVED: "RECEIVED",
  EMERGENCY_DETECTED: "EMERGENCY_DETECTED",
  POSSIBLE_EMERGENCY_DETECTED: "POSSIBLE_EMERGENCY_DETECTED",
  CLASSIFIED: "CLASSIFIED",
  CLASSIFICATION_FAILED: "CLASSIFICATION_FAILED",
  FLAGGED_FOR_REVIEW: "FLAGGED_FOR_REVIEW",
  ESCALATED: "ESCALATED",
  ESCALATION_ROUND: "ESCALATION_ROUND",
  ESCALATION_EXHAUSTED: "ESCALATION_EXHAUSTED",
  NO_REACHABLE_CONTACT: "NO_REACHABLE_CONTACT",
  NOTIFICATION_QUEUED: "NOTIFICATION_QUEUED",
  NOTIFICATION_SENT: "NOTIFICATION_SENT",
  NOTIFICATION_FAILED: "NOTIFICATION_FAILED",
  NOTIFICATION_DEAD: "NOTIFICATION_DEAD",
  NOTIFICATION_FALLBACK: "NOTIFICATION_FALLBACK",
  ACKNOWLEDGED: "ACKNOWLEDGED",
  BOOKING_CREATED: "BOOKING_CREATED",
  BOOKING_UPDATED: "BOOKING_UPDATED",
  QUESTION_SENT: "QUESTION_SENT",
} as const;

export type EventTypeName = (typeof EventType)[keyof typeof EventType];

type Tx = Prisma.TransactionClient;

export async function recordEvent(
  tx: Tx,
  requestId: string,
  type: EventTypeName,
  data?: Prisma.InputJsonValue,
  actorUserId?: string,
  at?: Date,
) {
  await tx.requestEvent.create({
    data: { requestId, type, data, actorUserId, ...(at ? { createdAt: at } : {}) },
  });
}
