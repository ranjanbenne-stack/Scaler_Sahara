import { Prisma } from "@prisma/client";
import type { Deps } from "../deps";
import type { TelegramUpdatePayload } from "../telegram/api";
import { detectEmergency, type EmergencyDetection } from "../emergency/detect";
import { FALLBACK_CATEGORY, maxUrgency, type UrgencyLevel } from "../classifier/schema";
import { EventType, recordEvent } from "../events";
import { enqueueNotifications, dispatchOutbox, type EnqueueInput } from "../notifications/outbox";
import { emergencyLevels, reachableChildren } from "../notifications/recipients";
import {
  attentionMessage,
  emergencyMessage,
  normalRequestMessage,
  parentReceiptMessage,
  requestLink,
  type RequestSummary,
} from "../notifications/messages";
import { rateLimit } from "../ratelimit";
import { redeemPairingCode } from "../auth/pairing";
import { log } from "../logger";

export type IntakeOutcome =
  | "duplicate"
  | "ignored"
  | "command"
  | "linked"
  | "link_failed"
  | "rate_limited"
  | "unauthorized"
  | "not_parent"
  | "request_created"
  | "emergency_created";

export interface IntakeResult {
  outcome: IntakeOutcome;
  requestId?: string;
}

const MAX_MESSAGE_LENGTH = 4000;

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/** Best-effort direct reply for non-request interactions (linking, help, rejections). */
async function reply(deps: Deps, chatId: bigint, text: string) {
  const res = await deps.channel.send({ chatId, text, urgent: false });
  if (!res.ok) log.warn("bot reply failed", { error: res.error });
}

/**
 * Entry point for every Telegram update (webhook or local polling).
 * Throwing signals the caller to return non-2xx so Telegram retries; any work
 * already committed is protected from duplication by update_id dedupe.
 */
export async function processTelegramUpdate(deps: Deps, update: TelegramUpdatePayload): Promise<IntakeResult> {
  const updateId = BigInt(update.update_id);
  const msg = update.message;

  // Only private-chat text messages from humans are accepted.
  if (!msg || !msg.from || msg.from.is_bot || msg.chat.type !== "private" || typeof msg.text !== "string") {
    return markSimple(deps, updateId, "ignored");
  }

  const text = msg.text.slice(0, MAX_MESSAGE_LENGTH);
  const telegramUserId = BigInt(msg.from.id);
  const chatId = BigInt(msg.chat.id);
  const trimmed = text.trim();

  // ── Commands ────────────────────────────────────────────────
  const cmd = trimmed.match(/^\/(start|link|help)(?:@\w+)?(?:\s+(.+))?$/i);
  if (cmd) {
    if (!(await claimUpdate(deps, updateId, "command"))) return { outcome: "duplicate" };
    const name = cmd[1].toLowerCase();
    const arg = cmd[2]?.trim();
    if ((name === "link" || name === "start") && arg) {
      return handleLink(deps, updateId, arg, { telegramUserId, chatId, username: msg.from.username });
    }
    return handleStartOrHelp(deps, telegramUserId, chatId);
  }

  // ── Identify sender by numeric Telegram id (never username) ──
  const account = await deps.db.telegramAccount.findUnique({
    where: { telegramUserId },
    include: { user: { include: { memberships: { include: { household: true } } } } },
  });
  const parentMembership = account?.user.memberships.find((m) => m.role === "PARENT");

  if (!account || account.chatId !== chatId || !parentMembership) {
    if (!(await claimUpdate(deps, updateId, account ? "not_parent" : "unauthorized"))) return { outcome: "duplicate" };
    // Rate-limit rejection replies so the bot can't be used to spam.
    if (await rateLimit(deps, `tg-reject:${telegramUserId}`, 3, 60_000)) {
      await reply(
        deps,
        chatId,
        account
          ? "SAHARA: This Telegram account is linked as a family member, not as the parent. Only the linked parent can send requests here."
          : "SAHARA: This Telegram account is not linked to a SAHARA household. Ask your family member to create a pairing code in the SAHARA dashboard, then send: /link CODE",
      );
    }
    log.info("rejected message from unlinked/unauthorized sender", { updateId });
    return { outcome: account ? "not_parent" : "unauthorized" };
  }

  const household = parentMembership.household;
  const parent = account.user;

  // ── Deterministic emergency detection BEFORE anything else ──
  const detection = detectEmergency(text);

  if (detection.level === "emergency") {
    // Emergencies are never rate-limited.
    return handleEmergency(deps, { updateId, text, householdId: household.id, householdName: household.name, parentId: parent.id, parentName: parent.displayName, parentChatId: chatId, detection });
  }

  if (!(await rateLimit(deps, `tg-msg:${telegramUserId}`, deps.config.RATE_LIMIT_MESSAGES_PER_MINUTE, 60_000))) {
    if (!(await claimUpdate(deps, updateId, "rate_limited"))) return { outcome: "duplicate" };
    await reply(deps, chatId, "SAHARA: You are sending messages very quickly. Please wait a minute. For an emergency, send SOS.");
    return { outcome: "rate_limited" };
  }

  return handleRequest(deps, { updateId, text, householdId: household.id, householdName: household.name, parentId: parent.id, parentName: parent.displayName, parentChatId: chatId, detection });
}

// ── Dedupe helpers ────────────────────────────────────────────

async function claimUpdate(deps: Deps, updateId: bigint, outcome: string, tx?: Prisma.TransactionClient): Promise<boolean> {
  try {
    await (tx ?? deps.db).telegramUpdate.create({ data: { updateId, outcome, receivedAt: deps.now() } });
    return true;
  } catch (err) {
    if (isUniqueViolation(err)) return false;
    throw err;
  }
}

async function markSimple(deps: Deps, updateId: bigint, outcome: "ignored"): Promise<IntakeResult> {
  return (await claimUpdate(deps, updateId, outcome)) ? { outcome } : { outcome: "duplicate" };
}

// ── Commands ──────────────────────────────────────────────────

async function handleStartOrHelp(deps: Deps, telegramUserId: bigint, chatId: bigint): Promise<IntakeResult> {
  const account = await deps.db.telegramAccount.findUnique({
    where: { telegramUserId },
    include: { user: { include: { memberships: true } } },
  });
  if (account && account.chatId === chatId) {
    await deps.db.telegramAccount.update({ where: { id: account.id }, data: { botStarted: true } });
    const isParent = account.user.memberships.some((m) => m.role === "PARENT");
    await reply(
      deps,
      chatId,
      isParent
        ? "SAHARA: You're connected. Send any request in your own words, e.g. \"I need an electrician to check my bedroom fan\". In an emergency send SOS."
        : "SAHARA: You're connected and will receive alerts from your parent here. Please make sure Telegram notifications and sound are enabled for this chat.",
    );
  } else {
    await reply(
      deps,
      chatId,
      "Welcome to SAHARA. To connect, ask your family member to generate a pairing code in the SAHARA dashboard, then send: /link CODE",
    );
  }
  return { outcome: "command" };
}

async function handleLink(
  deps: Deps,
  _updateId: bigint,
  code: string,
  tg: { telegramUserId: bigint; chatId: bigint; username?: string },
): Promise<IntakeResult> {
  const allowed = await rateLimit(deps, `tg-link:${tg.telegramUserId}`, deps.config.RATE_LIMIT_LINK_ATTEMPTS_PER_15_MIN, 15 * 60_000);
  if (!allowed) {
    await reply(deps, tg.chatId, "SAHARA: Too many pairing attempts. Please wait 15 minutes and try again.");
    return { outcome: "rate_limited" };
  }
  const res = await redeemPairingCode(deps, code, tg);
  if (!res.ok) {
    const why =
      res.reason === "already_linked"
        ? "This Telegram account is already linked to another SAHARA user."
        : res.reason === "parent_in_other_household"
          ? "This Telegram account is already the parent in another household."
          : "That code is invalid or has expired. Please ask for a new code from the SAHARA dashboard.";
    await reply(deps, tg.chatId, `SAHARA: ${why}`);
    return { outcome: "link_failed" };
  }
  await reply(
    deps,
    tg.chatId,
    res.role === "PARENT"
      ? `SAHARA: Hello ${res.displayName}, you're now connected to the "${res.householdName}" household. Send your requests here in your own words. In an emergency, send SOS.`
      : `SAHARA: Hello ${res.displayName}, your Telegram is now linked to "${res.householdName}". Alerts from your parent will arrive here. Please enable notification sound for this chat.`,
  );
  return { outcome: "linked" };
}

// ── Emergency path (no LLM) ───────────────────────────────────

interface IntakeCtx {
  updateId: bigint;
  text: string;
  householdId: string;
  householdName: string;
  parentId: string;
  parentName: string;
  parentChatId: bigint;
  detection: EmergencyDetection;
}

async function handleEmergency(deps: Deps, ctx: IntakeCtx): Promise<IntakeResult> {
  if (ctx.detection.level !== "emergency") throw new Error("handleEmergency requires an emergency detection");
  const det = ctx.detection;
  const now = deps.now();
  const isSos = det.rule === "SOS";

  // One transaction: dedupe marker + request + events + outbox. Either all of it
  // is committed, or nothing is and Telegram's retry will try again.
  let outboxIds: string[] = [];
  let parentOutboxIds: string[] = [];
  let requestId: string;
  try {
    const out = await deps.db.$transaction(async (tx) => {
      if (!(await claimUpdate(deps, ctx.updateId, "emergency_created", tx))) return null;

      const req = await tx.request.create({
        data: {
          householdId: ctx.householdId,
          parentUserId: ctx.parentId,
          telegramUpdateId: ctx.updateId,
          originalMessage: ctx.text,
          category: det.category,
          serviceType: null,
          issueSummary: isSos ? "SOS sent by parent" : `Emergency message (matched: "${det.matched}")`,
          urgency: "emergency",
          isEmergency: true,
          confidence: 1,
          status: "ESCALATED",
          detectionSource: isSos ? "RULE_SOS" : "RULE_PHRASE",
          classificationMeta: { detector: "deterministic-rules-v1", rule: det.rule, matched: det.matched, llmInvoked: false },
          escalationLevel: 0,
          nextEscalationAt: new Date(now.getTime() + deps.config.ESCALATION_ACK_TIMEOUT_SECONDS * 1000),
          createdAt: now,
        },
      });
      await tx.telegramUpdate.update({ where: { updateId: ctx.updateId }, data: { requestId: req.id } });
      await recordEvent(tx, req.id, EventType.RECEIVED, { channel: "telegram", updateId: ctx.updateId.toString() }, ctx.parentId, now);
      await recordEvent(tx, req.id, EventType.EMERGENCY_DETECTED, { rule: det.rule, matched: det.matched, category: det.category }, undefined, now);
      await recordEvent(tx, req.id, EventType.ESCALATED, { level: 0, reason: isSos ? "SOS keyword" : "emergency phrase" }, undefined, now);

      const levels = await emergencyLevels(tx, ctx.householdId);
      const summary: RequestSummary = { reference: req.reference, category: req.category, serviceType: null, issueSummary: req.issueSummary, urgency: "emergency", createdAt: now, parentName: ctx.parentName, householdName: ctx.householdName };
      const link = requestLink(deps.config.APP_BASE_URL, req.id);

      let ids: string[] = [];
      if (levels.length === 0) {
        await recordEvent(tx, req.id, EventType.NO_REACHABLE_CONTACT, { reason: "No child has linked Telegram and started the bot" }, undefined, now);
      } else {
        ids = await enqueueNotifications(
          tx,
          deps,
          levels[0].map<EnqueueInput>((r) => ({
            requestId: req.id,
            recipientUserId: r.userId,
            chatId: r.chatId,
            kind: "EMERGENCY",
            text: emergencyMessage(summary, link, { isSos }),
            idempotencyKey: `emergency:${req.id}:0:${r.userId}`,
          })),
        );
      }
      const parentIds = await enqueueNotifications(tx, deps, [
        {
          requestId: req.id,
          recipientUserId: ctx.parentId,
          chatId: ctx.parentChatId,
          kind: "SYSTEM",
          text:
            levels.length === 0
              ? `SAHARA: Your SOS was recorded (ref #${req.reference}) but no family member can be reached on Telegram yet. Please call your local emergency number or a neighbour now.`
              : parentReceiptMessage("emergency", req.reference),
          idempotencyKey: `receipt:${req.id}`,
        },
      ]);
      return { requestId: req.id, ids, parentIds };
    });
    if (!out) return { outcome: "duplicate" };
    requestId = out.requestId;
    outboxIds = out.ids;
    parentOutboxIds = out.parentIds;
  } catch (err) {
    if (isUniqueViolation(err)) return { outcome: "duplicate" };
    throw err;
  }

  log.info("emergency request created", { requestId, updateId: ctx.updateId, rule: det.rule });
  // Dispatch immediately — contacts first, then the parent's receipt. Failures are
  // recorded in the outbox and retried by the worker; they don't fail intake.
  await dispatchOutbox(deps, { ids: outboxIds }).catch((e) => log.error("emergency dispatch error", { requestId, err: String(e) }));
  await dispatchOutbox(deps, { ids: parentOutboxIds }).catch(() => {});
  return { outcome: "emergency_created", requestId };
}

// ── Normal / possible-emergency path ──────────────────────────

async function handleRequest(deps: Deps, ctx: IntakeCtx): Promise<IntakeResult> {
  const now = deps.now();
  const possible = ctx.detection.level === "possible" ? ctx.detection : null;

  // 1) Persist FIRST so the message is never lost, even if classification fails or the process dies.
  let requestId: string;
  try {
    const created = await deps.db.$transaction(async (tx) => {
      if (!(await claimUpdate(deps, ctx.updateId, "request_created", tx))) return null;
      const req = await tx.request.create({
        data: {
          householdId: ctx.householdId,
          parentUserId: ctx.parentId,
          telegramUpdateId: ctx.updateId,
          originalMessage: ctx.text,
          category: FALLBACK_CATEGORY,
          urgency: possible ? "urgent" : "routine",
          isEmergency: false,
          needsReview: Boolean(possible),
          status: possible ? "NEEDS_REVIEW" : "RECEIVED",
          detectionSource: possible ? "RULE_POSSIBLE" : "FALLBACK",
          createdAt: now,
        },
      });
      await tx.telegramUpdate.update({ where: { updateId: ctx.updateId }, data: { requestId: req.id } });
      await recordEvent(tx, req.id, EventType.RECEIVED, { channel: "telegram", updateId: ctx.updateId.toString() }, ctx.parentId, now);
      if (possible) {
        await recordEvent(tx, req.id, EventType.POSSIBLE_EMERGENCY_DETECTED, { matched: possible.matched, category: possible.category, urgencyFloor: "urgent" }, undefined, now);
      }
      return req.id;
    });
    if (!created) return { outcome: "duplicate" };
    requestId = created;
  } catch (err) {
    if (isUniqueViolation(err)) return { outcome: "duplicate" };
    throw err;
  }

  // 2) Possible emergency: alert the child NOW, before waiting on the LLM.
  if (possible) {
    await notifyChildren(deps, requestId, ctx, "ATTENTION", `Possible emergency wording ("${possible.matched}")`);
  }

  // 3) Classify (bounded by LLM_TIMEOUT_MS) and apply safety rules.
  await classifyAndFinalize(deps, requestId, ctx, Boolean(possible));
  return { outcome: (await isEmergency(deps, requestId)) ? "emergency_created" : "request_created", requestId };
}

async function isEmergency(deps: Deps, requestId: string): Promise<boolean> {
  const r = await deps.db.request.findUnique({ where: { id: requestId }, select: { isEmergency: true } });
  return Boolean(r?.isEmergency);
}

/**
 * Applies the classifier result under safety rules. Exported so the worker can
 * re-run it for requests whose classification was interrupted.
 */
export async function classifyAndFinalize(deps: Deps, requestId: string, ctx: Pick<IntakeCtx, "text" | "householdId" | "householdName" | "parentName" | "parentId" | "parentChatId">, alreadyAlerted: boolean) {
  const result = await deps.classifier.classify(ctx.text);
  const now = deps.now();
  const current = await deps.db.request.findUniqueOrThrow({ where: { id: requestId } });
  const floor: UrgencyLevel = current.urgency as UrgencyLevel;

  if (!result.ok) {
    await deps.db.$transaction(async (tx) => {
      await tx.request.update({
        where: { id: requestId },
        data: {
          category: FALLBACK_CATEGORY,
          needsReview: true,
          status: "NEEDS_REVIEW",
          detectionSource: current.detectionSource === "RULE_POSSIBLE" ? "RULE_POSSIBLE" : "FALLBACK",
          issueSummary: current.issueSummary ?? "Could not be classified automatically — please review",
          classificationMeta: { provider: result.provider, model: result.model, latencyMs: result.latencyMs, error: result.error },
        },
      });
      await recordEvent(tx, requestId, EventType.CLASSIFICATION_FAILED, { provider: result.provider, error: result.error }, undefined, now);
      await recordEvent(tx, requestId, EventType.FLAGGED_FOR_REVIEW, { reason: "classification failed" }, undefined, now);
    });
    if (!alreadyAlerted) await notifyChildren(deps, requestId, ctx, "ATTENTION", "Message could not be classified automatically");
    return;
  }

  const c = result.classification;

  // LLM may RAISE urgency to emergency (conservative) but can never lower a rule floor.
  if (c.is_emergency) {
    await promoteToEmergency(deps, requestId, ctx, { provider: result.provider, model: result.model, confidence: c.confidence });
    return;
  }

  const urgency = maxUrgency(floor, c.urgency);
  const lowConfidence = c.confidence < deps.config.LLM_MIN_CONFIDENCE;
  const needsReview = current.needsReview || lowConfidence || c.needs_clarification;
  await deps.db.$transaction(async (tx) => {
    await tx.request.update({
      where: { id: requestId },
      data: {
        category: c.category,
        serviceType: c.service_type,
        issueSummary: c.issue_summary,
        urgency,
        confidence: c.confidence,
        needsReview,
        clarificationQuestion: c.clarification_question,
        status: needsReview ? "NEEDS_REVIEW" : "RECEIVED",
        detectionSource: current.detectionSource === "RULE_POSSIBLE" ? "RULE_POSSIBLE" : "LLM",
        classificationMeta: { provider: result.provider, model: result.model, latencyMs: result.latencyMs, llmUrgency: c.urgency, appliedUrgency: urgency, raw: c },
      },
    });
    await recordEvent(tx, requestId, EventType.CLASSIFIED, { category: c.category, urgency, confidence: c.confidence, provider: result.provider, model: result.model }, undefined, now);
    if (needsReview) {
      await recordEvent(tx, requestId, EventType.FLAGGED_FOR_REVIEW, { reason: lowConfidence ? "low confidence" : c.needs_clarification ? "needs clarification" : "possible emergency" }, undefined, now);
    }
  });

  if (!alreadyAlerted) {
    const attention = urgency === "urgent" || needsReview;
    await notifyChildren(deps, requestId, ctx, attention ? "ATTENTION" : "NORMAL", attention ? (urgency === "urgent" ? "Marked urgent" : "Needs review") : undefined);
  }
  await sendParentReceipt(deps, requestId, ctx, alreadyAlerted ? "attention" : "normal");
}

async function promoteToEmergency(
  deps: Deps,
  requestId: string,
  ctx: Pick<IntakeCtx, "householdId" | "householdName" | "parentName" | "parentId" | "parentChatId">,
  meta: { provider: string; model: string; confidence: number },
) {
  const now = deps.now();
  const ids = await deps.db.$transaction(async (tx) => {
    const req = await tx.request.update({
      where: { id: requestId },
      data: {
        isEmergency: true,
        urgency: "emergency",
        category: "general_emergency",
        status: "ESCALATED",
        needsReview: true,
        detectionSource: "LLM",
        issueSummary: "Classifier flagged a possible emergency",
        confidence: meta.confidence,
        classificationMeta: { ...meta, promotedToEmergency: true },
        nextEscalationAt: new Date(now.getTime() + deps.config.ESCALATION_ACK_TIMEOUT_SECONDS * 1000),
      },
    });
    await recordEvent(tx, requestId, EventType.EMERGENCY_DETECTED, { source: "llm", ...meta }, undefined, now);
    await recordEvent(tx, requestId, EventType.ESCALATED, { level: 0, reason: "classifier flagged emergency" }, undefined, now);
    const levels = await emergencyLevels(tx, ctx.householdId);
    if (levels.length === 0) {
      await recordEvent(tx, requestId, EventType.NO_REACHABLE_CONTACT, {}, undefined, now);
      return [];
    }
    const summary: RequestSummary = { reference: req.reference, category: req.category, serviceType: null, issueSummary: req.issueSummary, urgency: "emergency", createdAt: req.createdAt, parentName: ctx.parentName, householdName: ctx.householdName };
    return enqueueNotifications(
      tx,
      deps,
      levels[0].map((r) => ({
        requestId,
        recipientUserId: r.userId,
        chatId: r.chatId,
        kind: "EMERGENCY" as const,
        text: emergencyMessage(summary, requestLink(deps.config.APP_BASE_URL, requestId), { isSos: false }),
        idempotencyKey: `emergency:${requestId}:0:${r.userId}`,
      })),
    );
  });
  await dispatchOutbox(deps, { ids }).catch((e) => log.error("emergency dispatch error", { requestId, err: String(e) }));
  await sendParentReceipt(deps, requestId, ctx, "emergency");
}

async function notifyChildren(
  deps: Deps,
  requestId: string,
  ctx: Pick<IntakeCtx, "householdId" | "householdName" | "parentName">,
  kind: "NORMAL" | "ATTENTION",
  reason?: string,
) {
  const ids = await deps.db.$transaction(async (tx) => {
    const req = await tx.request.findUniqueOrThrow({ where: { id: requestId } });
    const children = await reachableChildren(tx, ctx.householdId);
    if (children.length === 0) {
      await recordEvent(tx, requestId, EventType.NO_REACHABLE_CONTACT, { reason: "No child has linked Telegram and started the bot" }, undefined, deps.now());
      return [];
    }
    const summary: RequestSummary = { reference: req.reference, category: req.category, serviceType: req.serviceType, issueSummary: req.issueSummary, urgency: req.urgency, createdAt: req.createdAt, parentName: ctx.parentName, householdName: ctx.householdName };
    const link = requestLink(deps.config.APP_BASE_URL, requestId);
    return enqueueNotifications(
      tx,
      deps,
      children.map((c) => ({
        requestId,
        recipientUserId: c.userId,
        chatId: c.chatId,
        kind,
        text: kind === "ATTENTION" ? attentionMessage(summary, reason ?? "Needs review", link) : normalRequestMessage(summary, link),
        idempotencyKey: `${kind.toLowerCase()}:${requestId}:${c.userId}`,
      })),
    );
  });
  await dispatchOutbox(deps, { ids }).catch((e) => log.error("dispatch error", { requestId, err: String(e) }));
}

async function sendParentReceipt(
  deps: Deps,
  requestId: string,
  ctx: Pick<IntakeCtx, "parentId" | "parentChatId">,
  kind: "normal" | "attention" | "emergency",
) {
  const ids = await deps.db.$transaction(async (tx) => {
    const req = await tx.request.findUniqueOrThrow({ where: { id: requestId }, select: { reference: true } });
    return enqueueNotifications(tx, deps, [
      { requestId, recipientUserId: ctx.parentId, chatId: ctx.parentChatId, kind: "SYSTEM", text: parentReceiptMessage(kind, req.reference), idempotencyKey: `receipt:${requestId}` },
    ]);
  });
  await dispatchOutbox(deps, { ids }).catch(() => {});
}
