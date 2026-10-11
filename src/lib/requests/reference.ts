import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/** Next human-facing request number. One SQLite statement, so concurrent intake cannot reuse a number. */
export async function nextRequestReference(tx: Tx): Promise<number> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO request_counters (id, value) VALUES (1, 1)
    ON CONFLICT(id) DO UPDATE SET value = value + 1
    RETURNING value`;
  return Number(rows[0]?.value ?? 1);
}
