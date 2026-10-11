import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; sqliteReady?: Promise<void> };

export const prisma: PrismaClient = globalForPrisma.prisma ?? new PrismaClient();
globalForPrisma.prisma = prisma;

/** SQLite allows one writer. WAL plus a busy timeout lets the web app and in-process worker share the file. */
export function prepareSqlite(client: PrismaClient = prisma): Promise<void> {
  globalForPrisma.sqliteReady ??= client
    .$queryRawUnsafe("PRAGMA journal_mode = WAL")
    .then(() => client.$queryRawUnsafe("PRAGMA busy_timeout = 5000"))
    .then(() => undefined);
  return globalForPrisma.sqliteReady;
}

export type Db = PrismaClient;
