import { Prisma } from "@prisma/client";
import type { Deps } from "./deps";
import { dispatchOutbox, reclaimStuckSending } from "./notifications/outbox";
import { runEscalations } from "./escalation/escalation";
import { classifyAndFinalize, repairUnnotifiedRequests } from "./intake/process-update";
import { pruneRateLimits } from "./ratelimit";
import { log } from "./logger";

/**
 * Requests persisted but never classified (process crashed mid-intake) are
 * re-classified so they are never silently stuck. Window: older than 2 min.
 */
export async function recoverUnclassified(deps: Deps): Promise<number> {
  const cutoff = new Date(deps.now().getTime() - 120_000);
  const stuck = await deps.db.request.findMany({
    where: { isEmergency: false, classificationMeta: { equals: Prisma.DbNull }, createdAt: { lt: cutoff } },
    include: { parent: { include: { telegram: true } }, household: true },
    take: 20,
  });
  for (const r of stuck) {
    if (!r.parent.telegram) continue;
    await classifyAndFinalize(
      deps,
      r.id,
      {
        text: r.originalMessage,
        householdId: r.householdId,
        householdName: r.household.name,
        parentName: r.parent.displayName,
        parentId: r.parentUserId,
        parentChatId: r.parent.telegram.chatId,
      },
      r.detectionSource === "RULE_POSSIBLE",
    );
  }
  return stuck.length;
}

/** One worker iteration. Escalations first — they are the most time-critical. */
export async function workerTick(deps: Deps) {
  const escalated = await runEscalations(deps);
  const reclaimed = await reclaimStuckSending(deps);
  const dispatched = await dispatchOutbox(deps, { limit: 100 });
  const recovered = await recoverUnclassified(deps);
  const repaired = await repairUnnotifiedRequests(deps);
  await pruneRateLimits(deps);
  if (escalated || reclaimed || dispatched.sent || dispatched.failed || dispatched.dead || recovered || repaired) {
    log.info("worker tick", { escalated, reclaimed, ...dispatched, recovered, repaired });
  }
  return { escalated, reclaimed, dispatched, recovered, repaired };
}
