import { db } from "../src/lib/db";
const store = await db();
const cutoff = Date.now() - 30 * 86400000;
await store.batch(
  [
    ...["room_live", "messages", "reactions", "prize_images", "awards"].map(
      (table) => ({
        sql: `DELETE FROM ${table} WHERE room_id IN (SELECT id FROM rooms WHERE expires_at < ?)`,
        args: [cutoff],
      }),
    ),
    {
      sql: "DELETE FROM players WHERE room_id IN (SELECT id FROM rooms WHERE expires_at < ?)",
      args: [cutoff],
    },
    { sql: "DELETE FROM rooms WHERE expires_at < ?", args: [cutoff] },
    { sql: "DELETE FROM rate_limits WHERE expires_at < ?", args: [Date.now()] },
  ],
  "write",
);
console.log(
  "Expired event data has been cleaned up. Payment records are retained.",
);
