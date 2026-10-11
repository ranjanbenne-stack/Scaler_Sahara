import type { NextRequest } from "next/server";
import { z } from "zod";
import { getDeps } from "@/lib/deps";
import { currentUser, errors, json, sameOrigin } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

const Body = z.object({
  name: z.string().trim().min(1).max(100),
});

/** Creates another household and adds the signed-in user as a child member. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return errors.forbidden();
  const user = await currentUser();
  if (!user) return errors.unauthorized();
  const deps = getDeps();
  if (!(await rateLimit(deps, `household-create:${user.id}`, 5, 60 * 60_000))) return errors.tooMany();

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errors.badRequest(parsed.error.flatten().fieldErrors);

  const household = await deps.db.$transaction(async (tx) => {
    const created = await tx.household.create({ data: { name: parsed.data.name } });
    await tx.householdMembership.create({
      data: { householdId: created.id, userId: user.id, role: "CHILD", isEmergencyContact: true, escalationOrder: 1 },
    });
    return created;
  });
  return json({ ok: true, household: { id: household.id, name: household.name } });
}
