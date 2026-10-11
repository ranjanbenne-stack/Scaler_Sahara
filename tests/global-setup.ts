/**
 * Creates a throwaway SQLite file for the test run and applies Prisma migrations.
 * Set TEST_DATABASE_URL to reuse an existing file URL instead.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export async function setup() {
  let url = process.env.TEST_DATABASE_URL;
  if (!url) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sahara-test-"));
    const file = path.join(dir, "test.sqlite");
    const rel = path.relative(path.resolve(__dirname, "..", "prisma"), file).split(path.sep).join("/");
    url = `file:${rel}`;
  }
  process.env.DATABASE_URL = url;
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
}
