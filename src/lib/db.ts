import { createClient, type Client, type Transaction } from "@libsql/client";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomInt } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

let client: Client | undefined;
let initialized: Promise<void> | undefined;
export const SCHEMA_VERSION = 2;

export function databaseConfigured() {
  if (process.env.NODE_ENV !== "production") return true;
  try {
    const url = new URL(process.env.TURSO_DATABASE_URL || "");
    const preview = new URL(process.env.APP_URL || "");
    if (
      process.env.BINGO_E2E === "1" &&
      process.env.HOSTNAME === "127.0.0.1" &&
      ["127.0.0.1", "localhost"].includes(preview.hostname)
    )
      return url.protocol === "file:";
    return (
      ["libsql:", "https:"].includes(url.protocol) &&
      Boolean(url.hostname) &&
      !url.searchParams.has("tls")
    );
  } catch {
    return false;
  }
}

async function transaction<T>(
  store: Client,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    let tx: Transaction | undefined;
    try {
      tx = await store.transaction("write");
      const result = await fn(tx);
      if (!tx.closed) await tx.commit();
      return result;
    } catch (error) {
      if (tx) {
        try {
          await tx.rollback();
        } catch {
          /* Keep the original failure. */
        }
      }
      const code =
        error && typeof error === "object" && "code" in error ? error.code : "";
      if (
        attempt >= 4 ||
        !["SQLITE_BUSY", "TRANSACTION_ACTIVE"].includes(String(code))
      )
        throw error;
      await delay(20 * (attempt + 1) + randomInt(30));
    } finally {
      tx?.close();
    }
  }
}

export async function migrate(store: Client) {
  const exists = await store.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
  );
  if (exists.rows.length) {
    const version = Number(
      (
        await store.execute(
          "SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations",
        )
      ).rows[0].version,
    );
    if (version > SCHEMA_VERSION) throw new Error("DATABASE_SCHEMA_TOO_NEW");
    if (version === SCHEMA_VERSION) return;
  }
  await transaction(store, async (tx) => {
    await tx.execute(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)",
    );
    const current = Number(
      (
        await tx.execute(
          "SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations",
        )
      ).rows[0].version,
    );
    if (current > SCHEMA_VERSION) throw new Error("DATABASE_SCHEMA_TOO_NEW");
    if (current === SCHEMA_VERSION) {
      await tx.rollback();
      return;
    }
    if (current < 1) {
      await tx.executeMultiple(`
        CREATE TABLE IF NOT EXISTS rooms (
          id TEXT PRIMARY KEY, host_hash TEXT NOT NULL, title TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'lobby', plan TEXT NOT NULL DEFAULT 'free',
          drawn TEXT NOT NULL DEFAULT '[]', prizes TEXT NOT NULL DEFAULT '[]',
          created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
          revision INTEGER NOT NULL DEFAULT 1, checkout_id TEXT,
          checkout_version INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS players (
          id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
          auth_hash TEXT NOT NULL, name TEXT NOT NULL, name_key TEXT NOT NULL,
          card TEXT NOT NULL, bingo_at INTEGER, joined_at INTEGER NOT NULL,
          UNIQUE(room_id, name_key)
        );
        CREATE INDEX IF NOT EXISTS players_room ON players(room_id);
        CREATE TABLE IF NOT EXISTS payments (session_id TEXT PRIMARY KEY, room_id TEXT NOT NULL, paid_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
      `);
      await tx.execute({
        sql: "INSERT INTO schema_migrations VALUES(1,?)",
        args: [Date.now()],
      });
    }
    if (current < 2) {
      await tx.execute(
        "ALTER TABLE rooms ADD COLUMN game_number INTEGER NOT NULL DEFAULT 1",
      );
      await tx.executeMultiple(`
        CREATE UNIQUE INDEX IF NOT EXISTS rooms_host_hash ON rooms(host_hash);
        CREATE UNIQUE INDEX IF NOT EXISTS players_room_auth ON players(room_id,auth_hash);
        CREATE INDEX IF NOT EXISTS rooms_expiry ON rooms(expires_at);
        CREATE INDEX IF NOT EXISTS rate_limits_expiry ON rate_limits(expires_at);
        CREATE TABLE checkout_orders (
          id TEXT PRIMARY KEY, room_id TEXT NOT NULL, session_id TEXT UNIQUE,
          amount INTEGER NOT NULL, currency TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL,
          paid_at INTEGER
        );
        CREATE INDEX checkout_orders_room ON checkout_orders(room_id,created_at);
        INSERT INTO checkout_orders(id,room_id,session_id,amount,currency,status,created_at,paid_at)
          SELECT 'legacy-'||checkout_id,id,checkout_id,2980,'jpy',CASE WHEN plan='event' THEN 'paid' ELSE 'pending' END,created_at,CASE WHEN plan='event' THEN created_at ELSE NULL END
          FROM rooms WHERE checkout_id IS NOT NULL;
      `);
      await tx.execute({
        sql: "INSERT INTO schema_migrations VALUES(2,?)",
        args: [Date.now()],
      });
    }
  });
}

export async function db() {
  if (!databaseConfigured()) throw new Error("DATABASE_NOT_CONFIGURED");
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL || "file:data/bingo.db";
    if (url.startsWith("file:"))
      mkdirSync(dirname(url.slice(5)), { recursive: true });
    client = createClient({
      url,
      authToken: process.env.TURSO_AUTH_TOKEN,
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, {
          ...init,
          signal: AbortSignal.any([
            ...(init?.signal ? [init.signal] : []),
            AbortSignal.timeout(8000),
          ]),
        }),
    });
  }
  initialized ??= (async () => {
    if (client!.protocol === "file")
      await client!.execute("PRAGMA journal_mode=WAL");
    await migrate(client!);
  })().catch((error) => {
    initialized = undefined;
    throw error;
  });
  await initialized;
  return client;
}

export async function writeTransaction<T>(fn: (tx: Transaction) => Promise<T>) {
  return transaction(await db(), fn);
}
