import type { NextRequest } from "next/server";
import { z } from "zod";
import { getDeps } from "@/lib/deps";
import { currentUser, errors, json, sameOrigin } from "@/lib/http";
import { isChildOf } from "@/lib/requests/access";
import { createPairingCode } from "@/lib/auth/pairing";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

const Body = z.discriminatedUnion("role", [
  z.object({ role: z.literal("CHILD") }),
  z.object({ role: z.literal("PARENT"), parentDisplayName: z.string().trim().min(1).max(80) }),
]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return errors.forbidden();
  const user = await currentUser();
  if (!user) return errors.unauthorized();
  const { id: householdId } = await params;
  const deps = getDeps();
  if (!(await isChildOf(deps, user.id, householdId))) return errors.notFound();
  if (!(await rateLimit(deps, `pair-create:${user.id}`, 10, 15 * 60_000))) return errors.tooMany();

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errors.badRequest(parsed.error.flatten().fieldErrors);

  const { code, expiresAt } = await createPairingCode(deps, {
    householdId,
    createdById: user.id,
    role: parsed.data.role,
    targetUserId: parsed.data.role === "CHILD" ? user.id : undefined,
    parentDisplayName: parsed.data.role === "PARENT" ? parsed.data.parentDisplayName : undefined,
  });
  return json({ code, expiresAt });
}
