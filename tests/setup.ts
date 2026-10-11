import { afterAll, beforeAll } from "vitest";
import { db } from "./helpers";

beforeAll(async () => {
  await db.$queryRawUnsafe("PRAGMA journal_mode = WAL");
  await db.$queryRawUnsafe("PRAGMA busy_timeout = 5000");
});

afterAll(async () => {
  await db.$disconnect();
});
