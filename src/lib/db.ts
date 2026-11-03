import { createClient, type Client, type Transaction } from "@libsql/client";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomInt } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { AppError } from "./errors";

let client: Client | undefined;
let initialized: Promise<void> | undefined;
export const SCHEMA_VERSION = 3;

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
    if (current < 3) {
      await tx.executeMultiple(`
        ALTER TABLE rooms ADD COLUMN stage TEXT NOT NULL DEFAULT 'null';
        ALTER TABLE rooms ADD COLUMN featured_prize_id TEXT;
        ALTER TABLE rooms ADD COLUMN crew_hash TEXT;
        CREATE TABLE room_live (room_id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 1, chat_enabled INTEGER NOT NULL DEFAULT 1, pinned_id TEXT);
        INSERT INTO room_live(room_id) SELECT id FROM rooms;
        CREATE TABLE messages (id TEXT PRIMARY KEY, room_id TEXT NOT NULL, sender_id TEXT NOT NULL, name TEXT NOT NULL, body TEXT NOT NULL, is_host INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
        CREATE INDEX messages_room ON messages(room_id,created_at);
        CREATE INDEX messages_sender ON messages(room_id,sender_id,created_at);
        CREATE TABLE reactions (room_id TEXT NOT NULL, game_number INTEGER NOT NULL, draw_count INTEGER NOT NULL, player_id TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY(room_id,game_number,draw_count,player_id));
        CREATE TABLE prize_images (room_id TEXT NOT NULL, image_key TEXT NOT NULL, data_base64 TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(room_id,image_key));
        CREATE TABLE awards (id TEXT PRIMARY KEY, room_id TEXT NOT NULL, prize_id TEXT NOT NULL, player_id TEXT NOT NULL, player_name TEXT NOT NULL, prize_name TEXT NOT NULL, image_key TEXT, game_number INTEGER NOT NULL, claim_code TEXT NOT NULL, delivered_at INTEGER, cancelled_at INTEGER);
        CREATE INDEX awards_room ON awards(room_id,cancelled_at);
        INSERT INTO schema_migrations(version,applied_at) VALUES(3,unixepoch()*1000);
      `);
      await upgradeLegacyAwards(tx);
    }
  });
}

// Preserve physical prize allocations when upgrading or restoring a v2 event.
export async function upgradeLegacyAwards(tx: Transaction) {
  await tx.executeMultiple(`
    INSERT OR IGNORE INTO awards(id,room_id,prize_id,player_id,player_name,prize_name,game_number,claim_code)
      SELECT 'legacy-'||r.id||'-'||json_extract(p.value,'$.id'),r.id,json_extract(p.value,'$.id'),players.id,players.name,json_extract(p.value,'$.name'),r.game_number,printf('%06d',100000+abs(random()%900000))
      FROM rooms r,json_each(r.prizes) p JOIN players ON players.id=json_extract(p.value,'$.playerId') AND players.room_id=r.id
      WHERE json_extract(p.value,'$.playerId') IS NOT NULL AND json_extract(p.value,'$.awardId') IS NULL;
    UPDATE rooms SET prizes=(SELECT json_group_array(json(CASE WHEN a.id IS NULL THEN p.value ELSE json_set(p.value,'$.awardId',a.id,'$.awardedName',a.player_name,'$.awardedGame',a.game_number,'$.deliveredAt',a.delivered_at) END))
      FROM json_each(rooms.prizes) p LEFT JOIN awards a ON a.room_id=rooms.id AND a.prize_id=json_extract(p.value,'$.id') AND a.cancelled_at IS NULL)
      WHERE EXISTS (SELECT 1 FROM awards WHERE room_id=rooms.id AND id LIKE 'legacy-%');
  `);
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
          cache: "no-store",
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

// libSQL HTTP clients share one write stream per process. Bound waiting work and release on every outcome.
let writing = false;
const writeWaiters: (() => void)[] = [];
export async function writeTransaction<T>(fn: (tx: Transaction) => Promise<T>) {
  const store = await db();
  if (writing) {
    if (writeWaiters.length >= 128)
      throw new AppError(
        "操作が混み合っています。少し待って再度お試しください。",
        503,
        "WRITE_QUEUE_FULL",
        2,
      );
    await new Promise<void>((resolve, reject) => {
      const ready = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        const index = writeWaiters.indexOf(ready);
        if (index >= 0) writeWaiters.splice(index, 1);
        reject(
          new AppError(
            "操作の待ち時間が長くなっています。最新の状態を確認して再度お試しください。",
            503,
            "WRITE_QUEUE_TIMEOUT",
            2,
          ),
        );
      }, 8000);
      writeWaiters.push(ready);
    });
  } else writing = true;
  try {
    return await transaction(store, fn);
  } finally {
    const next = writeWaiters.shift();
    if (next) next();
    else writing = false;
  }
}
