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
