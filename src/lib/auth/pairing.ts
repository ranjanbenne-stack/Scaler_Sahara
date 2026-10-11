import type { MemberRole } from "@prisma/client";
import type { Deps } from "../deps";
import { generatePairingCode, normalizePairingCode, sha256 } from "./crypto";

export interface CreatePairingInput {
  householdId: string;
  createdById: string;
  role: MemberRole;
  /** CHILD codes link the creating dashboard user's own Telegram account. */
  targetUserId?: string;
  parentDisplayName?: string;
}

/** Returns the plaintext code ONCE; only its SHA-256 hash is stored. */
export async function createPairingCode(deps: Deps, input: CreatePairingInput): Promise<{ code: string; expiresAt: Date }> {
  const code = generatePairingCode();
  const expiresAt = new Date(deps.now().getTime() + deps.config.PAIRING_CODE_TTL_MINUTES * 60_000);
  // Invalidate earlier unused codes of the same kind for this target, so only one is live.
  await deps.db.pairingCode.updateMany({
    where: {
      householdId: input.householdId,
      role: input.role,
      usedAt: null,
      ...(input.role === "CHILD" ? { targetUserId: input.targetUserId } : {}),
    },
    data: { expiresAt: deps.now() },
  });
  await deps.db.pairingCode.create({
    data: {
      householdId: input.householdId,
      createdById: input.createdById,
      role: input.role,
      targetUserId: input.role === "CHILD" ? input.targetUserId : null,
      parentDisplayName: input.role === "PARENT" ? input.parentDisplayName : null,
      codeHash: sha256(code),
      expiresAt,
    },
  });
  return { code, expiresAt };
}

export type RedeemResult =
  | { ok: true; role: MemberRole; userId: string; displayName: string; householdName: string }
  | { ok: false; reason: "invalid" | "already_linked" | "parent_in_other_household" };

/**
 * Redeem a pairing code from a private Telegram chat. Single-use is enforced by
 * a conditional update inside the transaction; identity is the numeric
 * Telegram user id — never the username or display name.
 */
export async function redeemPairingCode(
  deps: Deps,
  rawCode: string,
  tg: { telegramUserId: bigint; chatId: bigint; username?: string },
): Promise<RedeemResult> {
  const codeHash = sha256(normalizePairingCode(rawCode));
  const now = deps.now();

  return deps.db.$transaction(async (tx) => {
    const pc = await tx.pairingCode.findUnique({ where: { codeHash }, include: { household: true } });
    if (!pc || pc.usedAt || pc.expiresAt <= now) return { ok: false, reason: "invalid" } as const;

    const existing = await tx.telegramAccount.findUnique({ where: { telegramUserId: tg.telegramUserId } });

    let userId: string;
    let displayName: string;

    if (pc.role === "CHILD") {
      if (!pc.targetUserId) return { ok: false, reason: "invalid" } as const;
      if (existing && existing.userId !== pc.targetUserId) return { ok: false, reason: "already_linked" } as const;
      const user = await tx.user.findUniqueOrThrow({ where: { id: pc.targetUserId } });
      userId = user.id;
      displayName = user.displayName;
      // Re-linking replaces the child's previous Telegram account, if any.
      await tx.telegramAccount.deleteMany({ where: { userId, NOT: { telegramUserId: tg.telegramUserId } } });
    } else {
      if (existing) {
        // The same Telegram account may not act as parent in two households.
        const otherParent = await tx.householdMembership.findFirst({
          where: { userId: existing.userId, role: "PARENT", NOT: { householdId: pc.householdId } },
        });
        if (otherParent) return { ok: false, reason: "parent_in_other_household" } as const;
        const isChildHere = await tx.householdMembership.findFirst({ where: { userId: existing.userId, role: "CHILD" } });
        if (isChildHere) return { ok: false, reason: "already_linked" } as const;
        userId = existing.userId;
        displayName = (await tx.user.findUniqueOrThrow({ where: { id: userId } })).displayName;
      } else {
        const user = await tx.user.create({ data: { displayName: pc.parentDisplayName || "Parent" } });
        userId = user.id;
        displayName = user.displayName;
      }
      await tx.householdMembership.upsert({
        where: { householdId_userId: { householdId: pc.householdId, userId } },
        create: { householdId: pc.householdId, userId, role: "PARENT" },
        update: {},
      });
    }

    const claimed = await tx.pairingCode.updateMany({
      where: { id: pc.id, usedAt: null },
      data: { usedAt: now, usedByTelegramUserId: tg.telegramUserId },
    });
    if (claimed.count !== 1) throw new Error("Pairing code was redeemed concurrently");

    await tx.telegramAccount.upsert({
      where: { telegramUserId: tg.telegramUserId },
      create: { userId, telegramUserId: tg.telegramUserId, chatId: tg.chatId, username: tg.username, botStarted: true, linkedAt: now },
      update: { chatId: tg.chatId, username: tg.username, botStarted: true },
    });

    return { ok: true, role: pc.role, userId, displayName, householdName: pc.household.name } as const;
  });
}
