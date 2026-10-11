import type { NextRequest } from "next/server";
import { z } from "zod";
import { getDeps } from "@/lib/deps";
import { currentUser, errors, json, sameOrigin } from "@/lib/http";
import { isChildOf } from "@/lib/requests/access";

export const runtime = "nodejs";

const Body = z.object({
  isEmergencyContact: z.boolean().optional(),
  escalationOrder: z.number().int().min(1).max(10).optional(),
});

/** Configure emergency contacts / escalation order for CHILD members of a household. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; membershipId: string }> }) {
  if (!sameOrigin(req)) return errors.forbidden();
  const user = await currentUser();
  if (!user) return errors.unauthorized();
  const { id: householdId, membershipId } = await params;
  const deps = getDeps();
  if (!(await isChildOf(deps, user.id, householdId))) return errors.notFound();

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errors.badRequest(parsed.error.flatten().fieldErrors);

  const member = await deps.db.householdMembership.findFirst({ where: { id: membershipId, householdId, role: "CHILD" } });
  if (!member) return errors.notFound();
  const updated = await deps.db.householdMembership.update({ where: { id: member.id }, data: parsed.data });
  return json({ ok: true, member: { id: updated.id, isEmergencyContact: updated.isEmergencyContact, escalationOrder: updated.escalationOrder } });
}

/** Remove a member from this household and from emergency escalation. You cannot remove yourself. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; membershipId: string }> }) {
  if (!sameOrigin(req)) return errors.forbidden();
  const user = await currentUser();
  if (!user) return errors.unauthorized();
  const { id: householdId, membershipId } = await params;
  const deps = getDeps();
  if (!(await isChildOf(deps, user.id, householdId))) return errors.notFound();

  const member = await deps.db.householdMembership.findFirst({ where: { id: membershipId, householdId } });
  if (!member) return errors.notFound();
  if (member.userId === user.id) return errors.badRequest({ reason: "cannot_remove_self" });

  const now = deps.now();
  await deps.db.$transaction(async (tx) => {
    await tx.householdMembership.delete({ where: { id: member.id } });
    await tx.pairingCode.updateMany({
      where: {
        householdId,
        usedAt: null,
        OR: [{ targetUserId: member.userId }, ...(member.role === "PARENT" ? [{ role: "PARENT" as const }] : [])],
      },
      data: { expiresAt: now },
    });
    const remaining = await tx.householdMembership.count({ where: { userId: member.userId } });
    if (remaining > 0) return;
    await tx.telegramAccount.deleteMany({ where: { userId: member.userId } });
    const account = await tx.user.findUnique({ where: { id: member.userId }, select: { email: true } });
    if (account?.email) return;
    const [requests, bookings, notifications] = await Promise.all([
      tx.request.count({ where: { OR: [{ parentUserId: member.userId }, { acknowledgedById: member.userId }] } }),
      tx.booking.count({ where: { bookedById: member.userId } }),
      tx.notificationOutbox.count({ where: { recipientUserId: member.userId } }),
    ]);
    if (requests > 0 || bookings > 0 || notifications > 0) return;
    await tx.session.deleteMany({ where: { userId: member.userId } });
    await tx.user.delete({ where: { id: member.userId } });
  });
  return json({ ok: true });
}
