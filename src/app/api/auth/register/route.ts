import type { NextRequest } from "next/server";
import { z } from "zod";
import { getDeps } from "@/lib/deps";
import { clientIp, errors, json, sameOrigin, setSessionCookie } from "@/lib/http";
import { hashPassword } from "@/lib/auth/crypto";
import { createSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

const Body = z.object({
  displayName: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(10).max(200),
  householdName: z.string().trim().min(1).max(100),
});

/** Registers a child account and creates their household (child = level-1 emergency contact). */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return errors.forbidden();
  const deps = getDeps();
  if (!(await rateLimit(deps, `register:${clientIp(req)}`, 5, 15 * 60_000))) return errors.tooMany();

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errors.badRequest(parsed.error.flatten().fieldErrors);
  const { displayName, email, password, householdName } = parsed.data;

  if (await deps.db.user.findUnique({ where: { email } })) {
    return json({ error: "email_taken" }, { status: 409 });
  }
  const passwordHash = await hashPassword(password);
  const user = await deps.db.$transaction(async (tx) => {
    const u = await tx.user.create({ data: { displayName, email, passwordHash } });
    const h = await tx.household.create({ data: { name: householdName } });
    await tx.householdMembership.create({ data: { householdId: h.id, userId: u.id, role: "CHILD", isEmergencyContact: true, escalationOrder: 1 } });
    return u;
  });
  const { token, expiresAt } = await createSession(deps, user.id);
  await setSessionCookie(token, expiresAt);
  return json({ ok: true });
}
