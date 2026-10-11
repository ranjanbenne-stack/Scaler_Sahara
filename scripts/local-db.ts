/**
 * Local development PostgreSQL using the `embedded-postgres` package (real
 * Postgres binaries installed from npm — no Docker required).
 *
 *   npm run db:local          # start and keep running (Ctrl+C to stop)
 *
 * Data lives in ./.pgdata (git-ignored). Matches DATABASE_URL in .env.example.
 * If you already have PostgreSQL (Docker, managed, native) just point
 * DATABASE_URL at it and skip this script.
 */
import EmbeddedPostgres from "embedded-postgres";
import path from "node:path";
import fs from "node:fs";

const port = Number(process.env.LOCAL_PG_PORT ?? 5433);
const dataDir = path.resolve(process.cwd(), ".pgdata");
const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "sahara",
  password: "sahara_local_dev",
  port,
  persistent: true,
  // Force UTF-8: on Windows initdb otherwise defaults to WIN1252, which rejects emoji.
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: () => {},
});

async function main() {
  const fresh = !fs.existsSync(path.join(dataDir, "PG_VERSION"));
  if (fresh) await pg.initialise();
  await pg.start();
  if (fresh) await pg.createDatabase("sahara");
  console.log(`Local PostgreSQL running on port ${port} (database "sahara"). Ctrl+C to stop.`);
  const stop = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch(async (err) => {
  console.error("Failed to start local PostgreSQL:", err);
  await pg.stop().catch(() => {});
  process.exit(1);
});
