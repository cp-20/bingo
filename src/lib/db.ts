import { createClient, type Client } from "@libsql/client";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

let client: Client | undefined;
let initialized: Promise<void> | undefined;

export function databaseConfigured() {
  return (
    process.env.NODE_ENV !== "production" ||
    Boolean(
      process.env.TURSO_DATABASE_URL?.startsWith("libsql://") ||
      process.env.TURSO_DATABASE_URL?.startsWith("https://"),
    )
  );
}

export async function db() {
  if (!databaseConfigured()) throw new Error("DATABASE_NOT_CONFIGURED");
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL || "file:data/bingo.db";
    if (url.startsWith("file:"))
      mkdirSync(dirname(url.slice(5)), { recursive: true });
    client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  }
  initialized ??= client
    .executeMultiple(
      `
    ${client.protocol === "file" ? "PRAGMA journal_mode = WAL;" : ""}
    PRAGMA foreign_keys = ON;
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
  `,
    )
    .then(() => {})
    .catch((error) => {
      initialized = undefined;
      throw error;
    });
  await initialized;
  return client;
}
