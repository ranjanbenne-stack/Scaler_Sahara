import type { BookingStatus } from "@prisma/client";
import type { Deps } from "../deps";
import { EventType, recordEvent } from "../events";
import { enqueueNotifications, dispatchOutbox } from "../notifications/outbox";
import { bookingUpdateMessage, questionToParentMessage, visitBookedMessage } from "../notifications/messages";
import { offerByCode, offersForRequest, visitSlot } from "./catalog";

type BookResult =
  | { ok: true; alreadyBooked: boolean; bookingId: string }
  | { ok: false; reason: "not_found" | "not_bookable" | "bad_offer" | "bad_slot" | "closed" };

type UpdateResult =
  | { ok: true; status: BookingStatus }
  | { ok: false; reason: "not_found" | "no_booking" | "bad_transition" };

type QuestionResult = { ok: true } | { ok: false; reason: "not_found" | "empty" };

/**
 * Book a handyman visit on a request the caller is already allowed to see.
 * The price comes from the catalog, not from the browser.
 */
export async function bookVisit(
  deps: Deps,
  requestId: string,
  userId: string,
  input: { serviceCode: string; visitId: string },
): Promise<BookResult> {
  const now = deps.now();
  const slot = visitSlot(input.visitId);
  const offer = offerByCode(input.serviceCode);
  if (!slot) return { ok: false, reason: "bad_slot" };
  if (!offer) return { ok: false, reason: "bad_offer" };

  const out = await deps.db.$transaction(async (tx) => {
    const req = await tx.request.findUnique({
      where: { id: requestId },
      include: { parent: { include: { telegram: true } }, booking: true },
    });
    if (!req) return { ok: false as const, reason: "not_found" as const, notify: [] as string[] };
    if (req.status === "CLOSED") return { ok: false as const, reason: "closed" as const, notify: [] as string[] };
    const allowed = offersForRequest(req);
    if (!allowed.some((item) => item.code === offer.code)) {
      return { ok: false as const, reason: "not_bookable" as const, notify: [] as string[] };
    }
    if (req.booking && req.booking.status !== "CANCELLED") {
      return { ok: true as const, alreadyBooked: true, bookingId: req.booking.id, notify: [] as string[] };
    }

    const son = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const data = {
      bookedById: userId,
      serviceCode: offer.code,
      serviceLabel: offer.label,
      helperLabel: offer.helperLabel,
      visitLabel: slot.label,
      estimatedCostInr: offer.estimatedCostInr,
      includes: offer.includes,
      status: "BOOKED" as const,
    };
    const booking = req.booking
      ? await tx.booking.update({ where: { id: req.booking.id }, data: { ...data, question: req.booking.question } })
      : await tx.booking.create({ data: { ...data, requestId } });

    if (req.status === "RECEIVED" || req.status === "NEEDS_REVIEW") {
      await tx.request.update({
        where: { id: requestId },
        data: { status: "ACKNOWLEDGED", acknowledgedAt: now, acknowledgedById: userId, nextEscalationAt: null },
      });
      await recordEvent(tx, requestId, EventType.ACKNOWLEDGED, { by: userId, byName: son.displayName, at: now.toISOString(), via: "booking" }, userId, now);
    }
    await recordEvent(
      tx,
      requestId,
      EventType.BOOKING_CREATED,
      { service: offer.label, when: slot.label, estimateInr: offer.estimatedCostInr, byName: son.displayName },
      userId,
      now,
    );

    let notify: string[] = [];
    if (req.parent.telegram?.botStarted) {
      notify = await enqueueNotifications(tx, deps, [
        {
          requestId,
          recipientUserId: req.parentUserId,
          chatId: req.parent.telegram.chatId,
          kind: "SYSTEM",
          text: visitBookedMessage(son.displayName, offer.label, slot.label, offer.estimatedCostInr, req.reference),
          idempotencyKey: `booking:${requestId}:${now.getTime()}`,
        },
      ]);
    }
    return { ok: true as const, alreadyBooked: false, bookingId: booking.id, notify };
  });

  if (!out.ok) return out;
  if (out.notify.length > 0) await dispatchOutbox(deps, { ids: out.notify }).catch(() => {});
  return { ok: true, alreadyBooked: out.alreadyBooked, bookingId: out.bookingId };
}

const NEXT_STATUS: Record<string, BookingStatus> = {
  confirm: "CONFIRMED",
  en_route: "EN_ROUTE",
  complete: "COMPLETED",
  cancel: "CANCELLED",
};

export async function updateBooking(
  deps: Deps,
  requestId: string,
  userId: string,
  action: "confirm" | "en_route" | "complete" | "cancel",
): Promise<UpdateResult> {
  const next = NEXT_STATUS[action];
  const now = deps.now();
  const out = await deps.db.$transaction(async (tx) => {
    const req = await tx.request.findUnique({
      where: { id: requestId },
      include: { parent: { include: { telegram: true } }, booking: true },
    });
    if (!req) return { ok: false as const, reason: "not_found" as const, notify: [] as string[] };
    if (!req.booking || req.booking.status === "CANCELLED" || req.booking.status === "COMPLETED") {
      return { ok: false as const, reason: "no_booking" as const, notify: [] as string[] };
    }
    const from = req.booking.status;
    const allowed =
      (action === "confirm" && from === "BOOKED") ||
      (action === "en_route" && (from === "BOOKED" || from === "CONFIRMED")) ||
      action === "complete" ||
      action === "cancel";
    if (!allowed) return { ok: false as const, reason: "bad_transition" as const, notify: [] as string[] };

    await tx.booking.update({ where: { id: req.booking.id }, data: { status: next } });
    if (next === "COMPLETED") {
      await tx.request.update({ where: { id: requestId }, data: { status: "CLOSED" } });
    }
    const son = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    await recordEvent(tx, requestId, EventType.BOOKING_UPDATED, { status: next, byName: son.displayName }, userId, now);

    let notify: string[] = [];
    if (req.parent.telegram?.botStarted) {
      notify = await enqueueNotifications(tx, deps, [
        {
          requestId,
          recipientUserId: req.parentUserId,
          chatId: req.parent.telegram.chatId,
          kind: "SYSTEM",
          text: bookingUpdateMessage(son.displayName, req.booking.serviceLabel, next, req.reference),
          idempotencyKey: `booking-status:${requestId}:${next}`,
        },
      ]);
    }
    return { ok: true as const, status: next, notify };
  });

  if (!out.ok) return { ok: false, reason: out.reason };
  if (out.notify.length > 0) await dispatchOutbox(deps, { ids: out.notify }).catch(() => {});
  return { ok: true, status: out.status };
}

export async function askParentQuestion(deps: Deps, requestId: string, userId: string, question: string): Promise<QuestionResult> {
  const text = question.trim();
  if (text.length < 2 || text.length > 300) return { ok: false, reason: "empty" };
  const now = deps.now();
  const out = await deps.db.$transaction(async (tx) => {
    const req = await tx.request.findUnique({
      where: { id: requestId },
      include: { parent: { include: { telegram: true } }, booking: true },
    });
    if (!req) return { ok: false as const, reason: "not_found" as const, notify: [] as string[] };
    const son = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (req.booking) await tx.booking.update({ where: { id: req.booking.id }, data: { question: text } });
    await recordEvent(tx, requestId, EventType.QUESTION_SENT, { question: text, byName: son.displayName }, userId, now);
    let notify: string[] = [];
    if (req.parent.telegram?.botStarted) {
      notify = await enqueueNotifications(tx, deps, [
        {
          requestId,
          recipientUserId: req.parentUserId,
          chatId: req.parent.telegram.chatId,
          kind: "SYSTEM",
          text: questionToParentMessage(son.displayName, req.reference, text),
          idempotencyKey: `question:${requestId}:${now.getTime()}`,
        },
      ]);
    }
    return { ok: true as const, notify };
  });
  if (!out.ok) return out;
  if (out.notify.length > 0) await dispatchOutbox(deps, { ids: out.notify }).catch(() => {});
  return { ok: true };
}
