import { mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";

import { sqlite } from "./db/index.js";
import { env } from "./env.js";

const backupDir = join(dirname(env.databasePath), "backups");
mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const destination = join(backupDir, `ionailabs-canvas-${stamp}.sqlite`);

await sqlite.backup(destination);

const backups = readdirSync(backupDir)
    .filter((name) => name.endsWith(".sqlite"))
    .map((name) => ({ name, time: statSync(join(backupDir, name)).mtimeMs }))
    .sort((a, b) => b.time - a.time);
backups.slice(7).forEach((item) => unlinkSync(join(backupDir, item.name)));
sqlite.close();

process.stdout.write(`${destination}\n`);
