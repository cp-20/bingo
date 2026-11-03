import type { Client } from "@libsql/client";
import { migrate, SCHEMA_VERSION } from "./db";

const tables = [
  "rooms",
  "players",
  "checkout_orders",
  "payments",
  "rate_limits",
] as const;
type Cell = string | number | null;
export type Snapshot = {
  format: 1;
  schema: number;
  createdAt: string;
  tables: Record<string, Record<string, Cell>[]>;
};

export async function snapshot(store: Client): Promise<Snapshot> {
  const tx = await store.transaction("read");
  try {
    const result: Snapshot = {
      format: 1,
      schema: SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      tables: {},
    };
    for (const table of tables) {
      const rows = (await tx.execute(`SELECT * FROM ${table} ORDER BY rowid`))
        .rows;
      result.tables[table] = rows.map(
        (row) =>
          Object.fromEntries(Object.entries(row)) as Record<string, Cell>,
      );
    }
    // This is a read-only snapshot; rollback releases it without changing data.
    await tx.rollback();
    return result;
  } finally {
    tx.close();
  }
}

export async function restoreSnapshot(store: Client, input: unknown) {
  if (!input || typeof input !== "object") throw new Error("Invalid backup");
  const backup = input as Snapshot;
  if (
    backup.format !== 1 ||
    backup.schema !== SCHEMA_VERSION ||
    !backup.tables ||
    tables.some((table) => !Array.isArray(backup.tables[table]))
  )
    throw new Error("Unsupported backup format or schema");
  await migrate(store);
  const tx = await store.transaction("write");
  try {
    for (const table of tables) {
      if (
        Number(
          (await tx.execute(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n,
        )
      )
        throw new Error("Restore requires an empty database");
      const allowed = new Set(
        (await tx.execute(`PRAGMA table_info(${table})`)).rows.map((row) =>
          String(row.name),
        ),
      );
      for (const row of backup.tables[table]) {
        const columns = Object.keys(row);
        if (
          !columns.length ||
          columns.some((key) => !allowed.has(key)) ||
          Object.values(row).some(
            (value) =>
              value !== null &&
              typeof value !== "string" &&
              (typeof value !== "number" || !Number.isFinite(value)),
          )
        )
          throw new Error("Invalid backup row");
        await tx.execute({
          sql: `INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
          args: columns.map((key) => row[key]),
        });
      }
    }
    await tx.commit();
  } catch (error) {
    try {
      await tx.rollback();
    } catch {}
    throw error;
  } finally {
    tx.close();
  }
}
