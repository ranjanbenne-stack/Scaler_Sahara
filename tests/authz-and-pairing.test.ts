import { beforeEach, describe, expect, it } from "vitest";
import { processTelegramUpdate } from "../src/lib/intake/process-update";
import { getRequestForUser, isChildOf, listRequestsForUser, overviewForUser } from "../src/lib/requests/access";
import { createPairingCode } from "../src/lib/auth/pairing";
import { createSession, getSessionUser } from "../src/lib/auth/session";
import { hashPassword, verifyPassword } from "../src/lib/auth/crypto";
import { Clock, PARENT_TG, db, makeDeps, resetDb, seedHousehold, tgUpdate } from "./helpers";

beforeEach(resetDb);

describe("household-level authorization", () => {
  it("9: a child cannot access another household's request by changing the id", async () => {
    const a = await seedHousehold("Household A");
    const b = await seedHousehold("Household B", { parent: 444, child: 555 });
    const { deps } = makeDeps();
    const { requestId } = await processTelegramUpdate(deps, tgUpdate("SOS", PARENT_TG));

    expect(await getRequestForUser(deps, a.child.id, requestId!)).not.toBeNull();
    expect(await getRequestForUser(deps, b.child.id, requestId!)).toBeNull();
    expect(await getRequestForUser(deps, b.child.id, "not-a-uuid")).toBeNull();
    expect(await listRequestsForUser(deps, b.child.id)).toHaveLength(0);
    expect((await overviewForUser(deps, b.child.id)).activeEmergencies).toBe(0);
    expect((await overviewForUser(deps, a.child.id)).activeEmergencies).toBe(1);
    // A parent user (no dashboard role) sees nothing.
    expect(await getRequestForUser(deps, a.parent.id, requestId!)).toBeNull();
    expect(await isChildOf(deps, b.child.id, a.household.id)).toBe(false);
  });
});

describe("account linking", () => {
  it("links a parent via a single-use code; reuse and expiry are rejected", async () => {
    const child = await db.user.create({ data: { displayName: "Asha", email: "asha@example.test" } });
    const household = await db.household.create({ data: { name: "Asha's Mum" } });
    await db.householdMembership.create({ data: { householdId: household.id, userId: child.id, role: "CHILD", isEmergencyContact: true } });
    const clock = new Clock();
    const { deps, channel } = makeDeps({ clock });

    const { code } = await createPairingCode(deps, { householdId: household.id, createdById: child.id, role: "PARENT", parentDisplayName: "Mum" });
    const stored = await db.pairingCode.findFirstOrThrow();
    expect(stored.codeHash).not.toContain(code); // only the hash is stored

    const linked = await processTelegramUpdate(deps, tgUpdate(`/link ${code.toLowerCase().slice(0, 4)}-${code.slice(4)}`, 7001));
    expect(linked.outcome).toBe("linked");
    const tg = await db.telegramAccount.findUniqueOrThrow({ where: { telegramUserId: 7001n }, include: { user: { include: { memberships: true } } } });
    expect(tg.user.displayName).toBe("Mum");
    expect(tg.user.memberships[0]).toMatchObject({ householdId: household.id, role: "PARENT" });
    expect(tg.botStarted).toBe(true);

    // Reuse by another Telegram account fails.
    expect((await processTelegramUpdate(deps, tgUpdate(`/link ${code}`, 7002))).outcome).toBe("link_failed");

    // Expired codes fail.
    const second = await createPairingCode(deps, { householdId: household.id, createdById: child.id, role: "CHILD", targetUserId: child.id });
    clock.advance(16 * 60_000);
    expect((await processTelegramUpdate(deps, tgUpdate(`/start ${second.code}`, 7003))).outcome).toBe("link_failed");
    expect(channel.to(7003)[0].text).toContain("invalid or has expired");

    // The newly linked parent can now create requests.
    expect((await processTelegramUpdate(deps, tgUpdate("SOS", 7001))).outcome).toBe("emergency_created");
  });

  it("links a child's Telegram to their dashboard account (deep-link /start CODE)", async () => {
    const { household, child } = await seedHousehold();
    await db.telegramAccount.delete({ where: { userId: child.id } });
    const { deps } = makeDeps();
    const { code } = await createPairingCode(deps, { householdId: household.id, createdById: child.id, role: "CHILD", targetUserId: child.id });
    expect((await processTelegramUpdate(deps, tgUpdate(`/start ${code}`, 8001))).outcome).toBe("linked");
    const tg = await db.telegramAccount.findUniqueOrThrow({ where: { userId: child.id } });
    expect(tg.telegramUserId).toBe(8001n);
    expect(tg.chatId).toBe(8001n);
  });

  it("rate-limits pairing attempts (brute force)", async () => {
    const { deps } = makeDeps({ env: { RATE_LIMIT_LINK_ATTEMPTS_PER_15_MIN: "3" } });
    const outcomes = [];
    for (let i = 0; i < 5; i++) outcomes.push((await processTelegramUpdate(deps, tgUpdate(`/link WRONG${i}XX`, 9100))).outcome);
    expect(outcomes).toEqual(["link_failed", "link_failed", "link_failed", "rate_limited", "rate_limited"]);
  });
});

describe("sessions and passwords", () => {
  it("hashes passwords and validates sessions with expiry", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);

    const user = await db.user.create({ data: { displayName: "S", email: "s@example.test", passwordHash: hash } });
    const clock = new Clock();
    const { deps } = makeDeps({ clock, env: { SESSION_TTL_HOURS: "1" } });
    const { token } = await createSession(deps, user.id);
    expect((await getSessionUser(deps, token))?.id).toBe(user.id);
    expect(await getSessionUser(deps, "forged-token")).toBeNull();
    clock.advance(2 * 3600_000);
    expect(await getSessionUser(deps, token)).toBeNull();
    expect(await db.session.count({ where: { tokenHash: token } })).toBe(0); // raw token never stored
  });
});
