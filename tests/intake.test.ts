import { beforeEach, describe, expect, it } from "vitest";
import { processTelegramUpdate } from "../src/lib/intake/process-update";
import { dispatchOutbox } from "../src/lib/notifications/outbox";
import { listRequestsForUser } from "../src/lib/requests/access";
import { CHILD_TG, Clock, MockChannel, PARENT_TG, STRANGER_TG, db, makeDeps, mockClassifier, resetDb, seedHousehold, tgUpdate } from "./helpers";

const ELECTRICIAN = "I need an electrician to come and check the fan in my bedroom.";

beforeEach(resetDb);

describe("normal request flow", () => {
  it("1+2+3: electrician request → home_maintenance, visible on the right household dashboard, child notified", async () => {
    const a = await seedHousehold("Household A");
    const b = await seedHousehold("Household B", { parent: 444, child: 555 });
    const classifier = mockClassifier();
    const { deps, channel } = makeDeps({ classifier });

    const res = await processTelegramUpdate(deps, tgUpdate(ELECTRICIAN, PARENT_TG));
    expect(res.outcome).toBe("request_created");

    const req = await db.request.findUniqueOrThrow({ where: { id: res.requestId! } });
    expect(req).toMatchObject({
      householdId: a.household.id,
      parentUserId: a.parent.id,
      originalMessage: ELECTRICIAN,
      category: "home_maintenance",
      serviceType: "electrician",
      issueSummary: "Bedroom fan needs inspection",
      urgency: "routine",
      isEmergency: false,
      status: "RECEIVED",
      detectionSource: "LLM",
    });
    expect(req.confidence).toBeCloseTo(0.95);

    // Dashboard visibility is scoped per household.
    const forA = await listRequestsForUser(deps, a.child.id);
    const forB = await listRequestsForUser(deps, b.child.id);
    expect(forA.map((r) => r.id)).toEqual([req.id]);
    expect(forB).toHaveLength(0);

    // Child gets the NON-EMERGENCY notification; nothing claims a booking.
    const toChild = channel.to(CHILD_TG);
    expect(toChild).toHaveLength(1);
    expect(toChild[0].text).toContain("SAHARA | NON-EMERGENCY");
    expect(toChild[0].text).toContain("Request: Electrician needed");
    expect(toChild[0].text).toContain("Issue: Bedroom fan needs inspection");
    expect(toChild[0].text).toContain("Urgency: Routine");
    expect(toChild[0].text).not.toMatch(/booked for you|is on the way|has been dispatched/i);
    expect(channel.to(555)).toHaveLength(0); // other household's child never notified

    const events = await db.requestEvent.findMany({ where: { requestId: req.id }, orderBy: { createdAt: "asc" } });
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["RECEIVED", "CLASSIFIED", "NOTIFICATION_QUEUED", "NOTIFICATION_SENT"]));
    const outbox = await db.notificationOutbox.findMany({ where: { requestId: req.id, recipientUserId: a.child.id } });
    expect(outbox).toHaveLength(1);
    expect(outbox[0].status).toBe("SENT");
  });
});

describe("emergency detection", () => {
  it("4: exact SOS triggers the emergency path without calling the LLM", async () => {
    const { child } = await seedHousehold();
    const classifier = mockClassifier();
    const { deps, channel } = makeDeps({ classifier });

    const res = await processTelegramUpdate(deps, tgUpdate("SOS", PARENT_TG));
    expect(res.outcome).toBe("emergency_created");
    expect(classifier.classify).not.toHaveBeenCalled();

    const req = await db.request.findUniqueOrThrow({ where: { id: res.requestId! } });
    expect(req).toMatchObject({ category: "general_emergency", urgency: "emergency", isEmergency: true, status: "ESCALATED", detectionSource: "RULE_SOS", acknowledgedAt: null });

    const alert = channel.to(CHILD_TG);
    expect(alert).toHaveLength(1);
    expect(alert[0].urgent).toBe(true);
    expect(alert[0].text).toContain("SAHARA EMERGENCY — SOS");
    expect(alert[0].text).toContain("Your parent (Test Household Parent) has sent an SOS.");
    expect(alert[0].text).toContain("Time received:");
    expect(alert[0].text).toContain("Contact your parent immediately");

    const outbox = await db.notificationOutbox.findFirstOrThrow({ where: { requestId: req.id, recipientUserId: child.id } });
    expect(outbox).toMatchObject({ kind: "EMERGENCY", status: "SENT" });
    const types = (await db.requestEvent.findMany({ where: { requestId: req.id } })).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["RECEIVED", "EMERGENCY_DETECTED", "ESCALATED", "NOTIFICATION_SENT"]));
    // Parent receives a receipt.
    expect(channel.to(PARENT_TG)[0].text).toContain("Your SOS was received");
  });

  it("5: a clear emergency phrase triggers the emergency path", async () => {
    await seedHousehold();
    const classifier = mockClassifier();
    const { deps, channel } = makeDeps({ classifier });

    const res = await processTelegramUpdate(deps, tgUpdate("I have fallen and I am alone", PARENT_TG));
    expect(res.outcome).toBe("emergency_created");
    expect(classifier.classify).not.toHaveBeenCalled();
    const req = await db.request.findUniqueOrThrow({ where: { id: res.requestId! } });
    expect(req).toMatchObject({ category: "medical_emergency", isEmergency: true, status: "ESCALATED", detectionSource: "RULE_PHRASE" });
    expect(channel.to(CHILD_TG)[0].text).toContain("SAHARA EMERGENCY ALERT");
  });

  it("possible emergency is never routine even if the LLM says routine, and the child is alerted first", async () => {
    await seedHousehold();
    const { deps, channel } = makeDeps({ classifier: mockClassifier({ category: "personal_assistance", service_type: null, issue_summary: "Feeling dizzy", urgency: "routine" }) });
    const res = await processTelegramUpdate(deps, tgUpdate("I feel dizzy today", PARENT_TG));
    const req = await db.request.findUniqueOrThrow({ where: { id: res.requestId! } });
    expect(req.urgency).toBe("urgent");
    expect(req.status).toBe("NEEDS_REVIEW");
    expect(req.needsReview).toBe(true);
    expect(channel.to(CHILD_TG)[0].text).toContain("NEEDS YOUR ATTENTION");
  });

  it("LLM may raise a message to emergency but never lowers rules", async () => {
    await seedHousehold();
    const { deps, channel } = makeDeps({ classifier: mockClassifier({ category: "other", urgency: "emergency", is_emergency: true, issue_summary: "Possible danger" }) });
    const res = await processTelegramUpdate(deps, tgUpdate("there is smoke coming from the kitchen", PARENT_TG));
    expect(res.outcome).toBe("emergency_created");
    const req = await db.request.findUniqueOrThrow({ where: { id: res.requestId! } });
    expect(req).toMatchObject({ isEmergency: true, status: "ESCALATED", detectionSource: "LLM" });
    expect(channel.to(CHILD_TG).some((m) => m.text.includes("SAHARA EMERGENCY"))).toBe(true);
  });
});

describe("robustness", () => {
  it("6: invalid LLM JSON neither crashes nor loses the request", async () => {
    await seedHousehold();
    const { deps, channel } = makeDeps({ classifier: mockClassifier("throw-json") });
    const res = await processTelegramUpdate(deps, tgUpdate(ELECTRICIAN, PARENT_TG));
    expect(res.outcome).toBe("request_created");
    const req = await db.request.findUniqueOrThrow({ where: { id: res.requestId! } });
    expect(req).toMatchObject({ originalMessage: ELECTRICIAN, category: "unclassified", status: "NEEDS_REVIEW", needsReview: true, detectionSource: "FALLBACK" });
    const types = (await db.requestEvent.findMany({ where: { requestId: req.id } })).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["RECEIVED", "CLASSIFICATION_FAILED", "FLAGGED_FOR_REVIEW"]));
    expect(channel.to(CHILD_TG)[0].text).toContain("could not be classified");
  });

  it("6b: a classifier that throws unexpectedly still leaves the request persisted", async () => {
    await seedHousehold();
    const classifier = mockClassifier();
    classifier.classify.mockRejectedValueOnce(new Error("boom"));
    const { deps } = makeDeps({ classifier });
    await expect(processTelegramUpdate(deps, tgUpdate(ELECTRICIAN, PARENT_TG, 777))).rejects.toThrow("boom");
    const req = await db.request.findUniqueOrThrow({ where: { telegramUpdateId: 777n } });
    expect(req.originalMessage).toBe(ELECTRICIAN); // persisted before classification; worker recovery re-classifies
  });

  it("7: duplicate Telegram updates do not create duplicate requests or alerts", async () => {
    await seedHousehold();
    const { deps, channel } = makeDeps();
    const normal = tgUpdate(ELECTRICIAN, PARENT_TG, 9001);
    const sos = tgUpdate("SOS", PARENT_TG, 9002);

    const first = await processTelegramUpdate(deps, normal);
    const again = await processTelegramUpdate(deps, normal);
    const sos1 = await processTelegramUpdate(deps, sos);
    const [sos2, sos3] = await Promise.all([processTelegramUpdate(deps, sos), processTelegramUpdate(deps, sos)]);

    expect(first.outcome).toBe("request_created");
    expect(again.outcome).toBe("duplicate");
    expect(sos1.outcome).toBe("emergency_created");
    expect([sos2.outcome, sos3.outcome]).toEqual(["duplicate", "duplicate"]);
    expect(await db.request.count()).toBe(2);
    expect(await db.request.count({ where: { isEmergency: true } })).toBe(1);
    expect(channel.to(CHILD_TG).filter((m) => m.text.includes("EMERGENCY — SOS"))).toHaveLength(1);
  });

  it("8: an unauthorized Telegram sender is rejected and cannot create requests", async () => {
    await seedHousehold();
    const { deps, channel } = makeDeps();
    const res = await processTelegramUpdate(deps, tgUpdate("SOS", STRANGER_TG));
    expect(res.outcome).toBe("unauthorized");
    expect(await db.request.count()).toBe(0);
    expect(channel.to(STRANGER_TG)[0].text).toContain("not linked");
  });

  it("8b: a spoofed username or a child account cannot send requests as the parent", async () => {
    await seedHousehold();
    const { deps } = makeDeps();
    const spoof = tgUpdate("SOS", STRANGER_TG);
    spoof.message!.from!.username = "parent_username";
    spoof.message!.from!.first_name = "Test Household Parent";
    expect((await processTelegramUpdate(deps, spoof)).outcome).toBe("unauthorized");
    expect((await processTelegramUpdate(deps, tgUpdate("I need a plumber", CHILD_TG))).outcome).toBe("not_parent");
    // Parent's id in a different chat (e.g. a group) is ignored.
    const group = tgUpdate("SOS", PARENT_TG);
    group.message!.chat = { id: -100123, type: "group" };
    expect((await processTelegramUpdate(deps, group)).outcome).toBe("ignored");
    expect(await db.request.count()).toBe(0);
  });

  it("10: a failed notification is recorded and retried safely without duplicates", async () => {
    const { child } = await seedHousehold();
    const channel = new MockChannel();
    const clock = new Clock();
    const { deps } = makeDeps({ channel, clock });

    channel.failNext(1); // first delivery attempt to the child fails (502)
    const res = await processTelegramUpdate(deps, tgUpdate(ELECTRICIAN, PARENT_TG));
    const row = await db.notificationOutbox.findFirstOrThrow({ where: { requestId: res.requestId!, recipientUserId: child.id } });
    expect(row).toMatchObject({ status: "FAILED", attempts: 1 });
    expect(row.lastError).toContain("502");
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(clock.now().getTime());

    // Not yet due → nothing is sent.
    await dispatchOutbox(deps);
    expect(channel.to(CHILD_TG)).toHaveLength(0);

    // After the backoff, the worker retries once and succeeds.
    clock.advance(31_000);
    await Promise.all([dispatchOutbox(deps), dispatchOutbox(deps)]); // concurrent workers must not double-send
    expect(channel.to(CHILD_TG)).toHaveLength(1);
    const after = await db.notificationOutbox.findUniqueOrThrow({ where: { id: row.id } });
    expect(after).toMatchObject({ status: "SENT", attempts: 2 });
    const types = (await db.requestEvent.findMany({ where: { requestId: res.requestId! } })).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["NOTIFICATION_FAILED", "NOTIFICATION_SENT"]));
  });

  it("10b: permanent failures stop retrying and are recorded as DEAD", async () => {
    await seedHousehold();
    const channel = new MockChannel();
    channel.failForChat.set(String(CHILD_TG), { ok: false, error: "Telegram sendMessage failed: 403 Forbidden: bot was blocked by the user", retryable: false });
    const { deps } = makeDeps({ channel });
    const res = await processTelegramUpdate(deps, tgUpdate(ELECTRICIAN, PARENT_TG));
    const row = await db.notificationOutbox.findFirstOrThrow({ where: { requestId: res.requestId!, kind: "NORMAL" } });
    expect(row.status).toBe("DEAD");
    expect(await db.requestEvent.count({ where: { requestId: res.requestId!, type: "NOTIFICATION_DEAD" } })).toBe(1);
  });

  it("SOS is never rate-limited", async () => {
    await seedHousehold();
    const { deps } = makeDeps({ env: { RATE_LIMIT_MESSAGES_PER_MINUTE: "1" } });
    await processTelegramUpdate(deps, tgUpdate("I need a plumber", PARENT_TG));
    expect((await processTelegramUpdate(deps, tgUpdate("I need a carpenter", PARENT_TG))).outcome).toBe("rate_limited");
    expect((await processTelegramUpdate(deps, tgUpdate("SOS", PARENT_TG))).outcome).toBe("emergency_created");
  });
});
