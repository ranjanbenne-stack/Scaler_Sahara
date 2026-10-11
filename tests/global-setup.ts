/**
 * Starts a throwaway PostgreSQL (embedded-postgres) for the test run and
 * applies the real Prisma migrations. Set TEST_DATABASE_URL to use an existing
 * disposable database instead (e.g. in CI with a Postgres service container).
 */
import EmbeddedPostgres from "embedded-postgres";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

let pg: EmbeddedPostgres | null = null;

export async function setup() {
  let url = process.env.TEST_DATABASE_URL;
  if (!url) {
    const port = Number(process.env.TEST_PG_PORT ?? 54329);
    const dir = path.resolve(__dirname, "..", ".pgdata-test");
    fs.rmSync(dir, { recursive: true, force: true });
    pg = new EmbeddedPostgres({ databaseDir: dir, user: "sahara_test", password: "sahara_test", port, persistent: false, initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {} });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase("sahara_test");
    url = `postgresql://sahara_test:sahara_test@localhost:${port}/sahara_test?schema=public`;
  }
  process.env.DATABASE_URL = url;
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
}

export async function teardown() {
  if (pg) await pg.stop();
}
