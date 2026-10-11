import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

export interface Recipient {
  userId: string;
  displayName: string;
  chatId: bigint;
  escalationOrder: number;
  isEmergencyContact: boolean;
}

/**
 * Children of the household who have linked Telegram AND started the bot.
 * The bot never DMs someone who has not started it.
 */
export async function reachableChildren(tx: Tx, householdId: string): Promise<Recipient[]> {
  const members = await tx.householdMembership.findMany({
    where: { householdId, role: "CHILD", user: { telegram: { botStarted: true } } },
    include: { user: { include: { telegram: true } } },
    orderBy: [{ escalationOrder: "asc" }, { createdAt: "asc" }],
  });
  return members
    .filter((m) => m.user.telegram)
    .map((m) => ({
      userId: m.userId,
      displayName: m.user.displayName,
      chatId: m.user.telegram!.chatId,
      escalationOrder: m.escalationOrder,
      isEmergencyContact: m.isEmergencyContact,
    }));
}

/**
 * Emergency responders grouped by escalation level (ascending). If no member is
 * flagged as an emergency contact, ALL reachable children are treated as level-1
 * responders — an emergency is never dropped for lack of configuration.
 */
export async function emergencyLevels(tx: Tx, householdId: string): Promise<Recipient[][]> {
  const children = await reachableChildren(tx, householdId);
  const flagged = children.filter((c) => c.isEmergencyContact);
  const pool = flagged.length > 0 ? flagged : children;
  const byOrder = new Map<number, Recipient[]>();
  for (const r of pool) {
    const order = flagged.length > 0 ? r.escalationOrder : 1;
    byOrder.set(order, [...(byOrder.get(order) ?? []), r]);
  }
  return [...byOrder.entries()].sort((a, b) => a[0] - b[0]).map(([, rs]) => rs);
}
