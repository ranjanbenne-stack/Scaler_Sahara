import type { NextRequest } from "next/server";
import { getDeps } from "@/lib/deps";
import { currentUser, errors, json } from "@/lib/http";
import { getRequestForUser } from "@/lib/requests/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return errors.unauthorized();
  const { id } = await params;
  const request = await getRequestForUser(getDeps(), user.id, id);
  // Same 404 whether the id doesn't exist or belongs to another household.
  if (!request) return errors.notFound();
  return json({ request });
}
