import { afterAll } from "vitest";
import { db } from "./helpers";

afterAll(async () => {
  await db.$disconnect();
});
