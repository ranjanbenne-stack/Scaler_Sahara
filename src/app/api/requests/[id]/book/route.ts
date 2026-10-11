import type { NextRequest } from "next/server";
import { z } from "zod";
import { bookVisit } from "@/lib/booking/book";
import { getDeps } from "@/lib/deps";
import { currentUser, errors, json, sameOrigin } from "@/lib/http";
import { getRequestForUser } from "@/lib/requests/access";

export const runtime = "nodejs";

const Body = z.object({
  serviceCode: z.string().trim().min(1).max(40),
  visitId: z.string().trim().min(1).max(40),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return errors.forbidden();
  const user = await currentUser();
  if (!user) return errors.unauthorized();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errors.badRequest();
  const { id } = await params;
  const deps = getDeps();
  const request = await getRequestForUser(deps, user.id, id);
  if (!request) return errors.notFound();
  const result = await bookVisit(deps, id, user.id, parsed.data);
  if (!result.ok) return errors.badRequest({ reason: result.reason });
  return json(result);
}
