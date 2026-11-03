import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { db } from "../src/lib/db";
import { snapshot } from "../src/lib/backup";
const output = resolve(
  process.argv[2] ||
    `backups/bingo-${new Date().toISOString().replaceAll(":", "-")}.json`,
);
mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
writeFileSync(output, JSON.stringify(await snapshot(await db())), {
  flag: "wx",
  mode: 0o600,
});
console.log(
  `Private backup saved to ${output}. Store an encrypted copy outside the app host.`,
);
