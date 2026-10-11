import type { NextRequest } from "next/server";
import { getDeps } from "@/lib/deps";
import { currentUser, errors, json, sameOrigin } from "@/lib/http";
import { getRequestForUser } from "@/lib/requests/access";
import { acknowledgeEmergency } from "@/lib/escalation/escalation";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return errors.forbidden();
  const user = await currentUser();
  if (!user) return errors.unauthorized();
  const { id } = await params;
  const deps = getDeps();

  // Authorization: request must belong to a household where the user is a CHILD.
  const request = await getRequestForUser(deps, user.id, id);
  if (!request) return errors.notFound();

  const res = await acknowledgeEmergency(deps, id, user.id);
  if (!res.ok) return res.reason === "not_found" ? errors.notFound() : errors.badRequest({ reason: res.reason });
  return json(res);
}
