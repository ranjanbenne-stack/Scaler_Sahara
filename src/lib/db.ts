import { Prisma, PrismaClient } from "@prisma/client";

/**
 * Prisma stores DateTime as UTC in `timestamp` (no time zone) columns. Raw SQL
 * Date parameters would otherwise be converted using the DB session time zone,
 * so always pass timestamps to raw queries through this helper.
 */
export function utcTs(d: Date): Prisma.Sql {
  return Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export type Db = PrismaClient;
