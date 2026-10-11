import type { Prisma } from "@prisma/client";
import type { Deps } from "../deps";

/**
 * Household-level authorization. Every dashboard read/write goes through these
 * helpers, which scope queries to households where the user is a CHILD member.
 * A request id from another household yields `null` (→ 404), never its data.
 */
export async function childHouseholdIds(deps: Pick<Deps, "db">, userId: string): Promise<string[]> {
  const ms = await deps.db.householdMembership.findMany({ where: { userId, role: "CHILD" }, select: { householdId: true } });
  return ms.map((m) => m.householdId);
}

export async function isChildOf(deps: Pick<Deps, "db">, userId: string, householdId: string): Promise<boolean> {
  const m = await deps.db.householdMembership.findUnique({ where: { householdId_userId: { householdId, userId } } });
  return m?.role === "CHILD";
}

const listSelect = {
  id: true,
  reference: true,
  householdId: true,
  createdAt: true,
  updatedAt: true,
  originalMessage: true,
  category: true,
  serviceType: true,
  issueSummary: true,
  urgency: true,
  isEmergency: true,
  needsReview: true,
  status: true,
  confidence: true,
  acknowledgedAt: true,
  escalationLevel: true,
  parent: { select: { id: true, displayName: true } },
  household: { select: { id: true, name: true } },
} satisfies Prisma.RequestSelect;

export async function listRequestsForUser(
  deps: Pick<Deps, "db">,
  userId: string,
  opts: { limit?: number; status?: string; emergencyOnly?: boolean } = {},
) {
  const householdIds = await childHouseholdIds(deps, userId);
  if (householdIds.length === 0) return [];
  return deps.db.request.findMany({
    where: {
      householdId: { in: householdIds },
      ...(opts.emergencyOnly ? { isEmergency: true } : {}),
      ...(opts.status ? { status: opts.status as Prisma.EnumRequestStatusFilter["equals"] } : {}),
    },
    select: listSelect,
    orderBy: { createdAt: "desc" },
    take: Math.min(opts.limit ?? 100, 500),
  });
}

export async function getRequestForUser(deps: Pick<Deps, "db">, userId: string, requestId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) return null;
  const householdIds = await childHouseholdIds(deps, userId);
  if (householdIds.length === 0) return null;
  return deps.db.request.findFirst({
    where: { id: requestId, householdId: { in: householdIds } },
    include: {
      parent: { select: { id: true, displayName: true } },
      household: { select: { id: true, name: true } },
      acknowledgedBy: { select: { id: true, displayName: true } },
      events: { orderBy: { createdAt: "asc" } },
      notifications: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          kind: true,
          status: true,
          attempts: true,
          maxAttempts: true,
          lastError: true,
          sentAt: true,
          createdAt: true,
          nextAttemptAt: true,
          recipient: { select: { id: true, displayName: true } },
        },
      },
    },
  });
}

export async function overviewForUser(deps: Pick<Deps, "db">, userId: string) {
  const householdIds = await childHouseholdIds(deps, userId);
  if (householdIds.length === 0) return { open: 0, attention: 0, activeEmergencies: 0 };
  const scope = { householdId: { in: householdIds } };
  const [open, attention, activeEmergencies] = await Promise.all([
    deps.db.request.count({ where: { ...scope, status: { in: ["RECEIVED", "NEEDS_REVIEW", "ESCALATED"] } } }),
    deps.db.request.count({ where: { ...scope, OR: [{ status: "NEEDS_REVIEW" }, { status: "ESCALATED" }, { urgency: "urgent" , status: { not: "CLOSED" } }] } }),
    deps.db.request.count({ where: { ...scope, isEmergency: true, status: "ESCALATED" } }),
  ]);
  return { open, attention, activeEmergencies };
}
