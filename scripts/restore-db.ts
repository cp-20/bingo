import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createClient } from "@libsql/client";
import { restoreSnapshot } from "../src/lib/backup";
if (!process.argv[2] || !process.argv[3])
  throw new Error(
    "Usage: npm run db:restore -- backup.json NEW_LOCAL_DATABASE.db",
  );
const target = resolve(process.argv[3]);
if (existsSync(target))
  throw new Error("Refusing to overwrite an existing database");
mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
const store = createClient({ url: `file:${target}` });
chmodSync(target, 0o600);
try {
  await restoreSnapshot(
    store,
    JSON.parse(readFileSync(process.argv[2], "utf8")),
  );
} finally {
  store.close();
}
console.log(
  `Restored into ${target}. Verify it before any production cutover.`,
);
