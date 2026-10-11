import type { NextRequest } from "next/server";
import { z } from "zod";
import { createPairingCode } from "@/lib/auth/pairing";
import { getDeps } from "@/lib/deps";
import { currentUser, errors, json, sameOrigin } from "@/lib/http";
import { isChildOf } from "@/lib/requests/access";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

const Body = z.object({
  displayName: z.string().trim().min(1).max(80),
  isEmergencyContact: z.boolean().optional().default(false),
  escalationOrder: z.number().int().min(1).max(5).optional().default(2),
});

/** Adds a family member and a one-time Telegram link code. No email is sent. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return errors.forbidden();
  const user = await currentUser();
  if (!user) return errors.unauthorized();
  const { id: householdId } = await params;
  const deps = getDeps();
  if (!(await isChildOf(deps, user.id, householdId))) return errors.notFound();
  if (!(await rateLimit(deps, `member-create:${user.id}`, 10, 60 * 60_000))) return errors.tooMany();

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errors.badRequest(parsed.error.flatten().fieldErrors);
  const { displayName, isEmergencyContact, escalationOrder } = parsed.data;

  const member = await deps.db.$transaction(async (tx) => {
    const created = await tx.user.create({ data: { displayName } });
    const membership = await tx.householdMembership.create({
      data: { householdId, userId: created.id, role: "CHILD", isEmergencyContact, escalationOrder },
    });
    return { userId: created.id, membershipId: membership.id, displayName };
  });
  const { code, expiresAt } = await createPairingCode(deps, {
    householdId,
    createdById: user.id,
    role: "CHILD",
    targetUserId: member.userId,
  });
  return json({ ok: true, member, code, expiresAt });
}
