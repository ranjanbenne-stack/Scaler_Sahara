// Creates the directory for the SQLite file before Prisma migrate runs.
// Prisma resolves file: paths relative to the prisma/ folder.
import fs from "node:fs";
import path from "node:path";

const envFile = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  }
}

const url = process.env.DATABASE_URL ?? "file:../data/sahara.sqlite";
if (!url.startsWith("file:")) {
  console.error("DATABASE_URL must be a SQLite file URL, for example file:../data/sahara.sqlite");
  process.exit(1);
}

let filePath = url.slice("file:".length).replace(/^\/\//, "");
if (!path.isAbsolute(filePath)) filePath = path.resolve(process.cwd(), "prisma", filePath);
fs.mkdirSync(path.dirname(filePath), { recursive: true });
console.log(`SQLite directory ready: ${path.dirname(filePath)}`);
