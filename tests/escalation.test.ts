import { beforeEach, describe, expect, it } from "vitest";
import { processTelegramUpdate } from "../src/lib/intake/process-update";
import { acknowledgeEmergency, runEscalations } from "../src/lib/escalation/escalation";
import { workerTick } from "../src/lib/worker";
import { CHILD2_TG, CHILD_TG, Clock, MockChannel, PARENT_TG, addChild, db, makeDeps, resetDb, seedHousehold, tgUpdate } from "./helpers";

beforeEach(resetDb);

const sosAlerts = (channel: MockChannel, chat: number) => channel.to(chat).filter((m) => m.text.includes("SAHARA EMERGENCY"));

describe("emergency acknowledgement and escalation", () => {
  it("11: an emergency stays unacknowledged until explicitly acknowledged — sending a notification never resolves it", async () => {
    const { child, parent } = await seedHousehold();
    const clock = new Clock();
    const { deps, channel } = makeDeps({ clock });

    const { requestId } = await processTelegramUpdate(deps, tgUpdate("SOS", PARENT_TG));
    expect(sosAlerts(channel, CHILD_TG)).toHaveLength(1);

    // Notifications delivered and time passes; the worker runs — still unacknowledged.
    clock.advance(30_000);
    await workerTick(deps);
    let req = await db.request.findUniqueOrThrow({ where: { id: requestId! } });
    expect(req.status).toBe("ESCALATED");
    expect(req.acknowledgedAt).toBeNull();

    clock.advance(10_000);
    const ack = await acknowledgeEmergency(deps, requestId!, child.id);
    expect(ack).toMatchObject({ ok: true, alreadyAcknowledged: false, acknowledgedById: child.id });

    req = await db.request.findUniqueOrThrow({ where: { id: requestId! } });
    expect(req.status).toBe("ACKNOWLEDGED");
    expect(req.acknowledgedById).toBe(child.id);
    expect(req.acknowledgedAt?.toISOString()).toBe(clock.now().toISOString());
    expect(req.nextEscalationAt).toBeNull();

    const ackEvent = await db.requestEvent.findFirstOrThrow({ where: { requestId: requestId!, type: "ACKNOWLEDGED" } });
    expect(ackEvent.actorUserId).toBe(child.id);
    expect(channel.to(PARENT_TG).some((m) => m.text.includes("has seen your SOS alert"))).toBe(true);
    expect(parent.id).toBeDefined();

    // Acknowledging again is idempotent and keeps the original acknowledger/time.
    clock.advance(5_000);
    const again = await acknowledgeEmergency(deps, requestId!, child.id);
    expect(again).toMatchObject({ ok: true, alreadyAcknowledged: true });
    expect(await db.requestEvent.count({ where: { requestId: requestId!, type: "ACKNOWLEDGED" } })).toBe(1);

    // No further escalation after acknowledgement.
    clock.advance(10 * 60_000);
    expect(await runEscalations(deps)).toBe(0);
  });

  it("12: an unacknowledged alert escalates to the next responder, then re-alerts, then stops (still unacknowledged)", async () => {
    const { household } = await seedHousehold();
    const second = await addChild(household.id, CHILD2_TG, 2, "Sibling");
    const clock = new Clock();
    const { deps, channel } = makeDeps({ clock, env: { ESCALATION_ACK_TIMEOUT_SECONDS: "120", ESCALATION_MAX_ROUNDS: "3" } });

    const { requestId } = await processTelegramUpdate(deps, tgUpdate("SOS", PARENT_TG));
    // Round 0: only level-1 contact.
    expect(sosAlerts(channel, CHILD_TG)).toHaveLength(1);
    expect(sosAlerts(channel, CHILD2_TG)).toHaveLength(0);

    // Before timeout: nothing happens.
    clock.advance(119_000);
    expect(await runEscalations(deps)).toBe(0);

    // Timeout → round 1 → next level (sibling).
    clock.advance(2_000);
    expect(await runEscalations(deps)).toBe(1);
    expect(sosAlerts(channel, CHILD2_TG)).toHaveLength(1);
    expect(sosAlerts(channel, CHILD2_TG)[0].text).toContain("ESCALATION (round 1)");
    expect(sosAlerts(channel, CHILD_TG)).toHaveLength(1);

    // Concurrent workers can't double-escalate the same round.
    clock.advance(121_000);
    const counts = await Promise.all([runEscalations(deps), runEscalations(deps)]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
    // Round 2: levels exhausted → everyone re-alerted.
    expect(sosAlerts(channel, CHILD_TG)).toHaveLength(2);
    expect(sosAlerts(channel, CHILD2_TG)).toHaveLength(2);

    clock.advance(121_000);
    expect(await runEscalations(deps)).toBe(1); // round 3 = max
    clock.advance(10 * 60_000);
    expect(await runEscalations(deps)).toBe(0); // stopped re-alerting

    const req = await db.request.findUniqueOrThrow({ where: { id: requestId! } });
    expect(req.status).toBe("ESCALATED"); // never auto-resolved
    expect(req.acknowledgedAt).toBeNull();
    expect(req.escalationLevel).toBe(3);
    const types = (await db.requestEvent.findMany({ where: { requestId: requestId! }, orderBy: { createdAt: "asc" } })).map((e) => e.type);
    expect(types.filter((t) => t === "ESCALATION_ROUND")).toHaveLength(3);
    expect(types).toContain("ESCALATION_EXHAUSTED");

    // A second-level responder can still acknowledge.
    const ack = await acknowledgeEmergency(deps, requestId!, second.id);
    expect(ack.ok && ack.acknowledgedById).toBe(second.id);
  });

  it("failed emergency delivery triggers the fallback (immediate escalation) instead of being dropped", async () => {
    const { household } = await seedHousehold();
    await addChild(household.id, CHILD2_TG, 2, "Sibling");
    const channel = new MockChannel();
    channel.failForChat.set(String(CHILD_TG), { ok: false, error: "Telegram sendMessage failed: 403 Forbidden: bot was blocked by the user", retryable: false });
    const clock = new Clock();
    const { deps } = makeDeps({ channel, clock });

    const { requestId } = await processTelegramUpdate(deps, tgUpdate("SOS", PARENT_TG));
    const req = await db.request.findUniqueOrThrow({ where: { id: requestId! } });
    expect(req.nextEscalationAt?.getTime()).toBe(clock.now().getTime()); // escalate now, don't wait 120s
    expect(await db.requestEvent.count({ where: { requestId: requestId!, type: "NOTIFICATION_FALLBACK" } })).toBe(1);

    await workerTick(deps);
    expect(sosAlerts(channel, CHILD2_TG)).toHaveLength(1);
  });

  it("escalation re-alerts queued before acknowledgement are cancelled, not sent", async () => {
    const { child } = await seedHousehold();
    const channel = new MockChannel();
    const clock = new Clock();
    const { deps } = makeDeps({ channel, clock });
    const { requestId } = await processTelegramUpdate(deps, tgUpdate("SOS", PARENT_TG));

    clock.advance(121_000);
    channel.failNext(1); // round-1 re-alert fails and is queued for retry
    await runEscalations(deps);
    await acknowledgeEmergency(deps, requestId!, child.id);
    clock.advance(60_000);
    await workerTick(deps);

    const esc = await db.notificationOutbox.findMany({ where: { requestId: requestId!, kind: "ESCALATION" } });
    expect(esc.every((r) => r.status === "CANCELLED")).toBe(true);
  });

  it("no reachable child: the emergency is still recorded, flagged, and the parent is told to call for help", async () => {
    const { child } = await seedHousehold();
    await db.telegramAccount.update({ where: { userId: child.id }, data: { botStarted: false } });
    const { deps, channel } = makeDeps();
    const { requestId } = await processTelegramUpdate(deps, tgUpdate("SOS", PARENT_TG));
    expect(await db.requestEvent.count({ where: { requestId: requestId!, type: "NO_REACHABLE_CONTACT" } })).toBe(1);
    expect(channel.to(CHILD_TG)).toHaveLength(0); // never DM someone who hasn't started the bot
    expect(channel.to(PARENT_TG)[0].text).toContain("call your local emergency number");
  });
});
