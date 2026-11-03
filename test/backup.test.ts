import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { restoreSnapshot, snapshot } from "../src/lib/backup";
process.env.TURSO_DATABASE_URL = `file:${join(mkdtempSync(join(tmpdir(), "bingo-backup-")), "source.db")}`;
const { db } = await import("../src/lib/db");
const { createRoom, joinRoom, hostAction, getView } =
  await import("../src/lib/service");
test("restoring a snapshot preserves private credentials, cards, and draws and refuses an overwrite", async () => {
  const room = await createRoom("Backup rehearsal", "backup");
  const player = await joinRoom(room.id, "Alice", undefined);
  await hostAction(room.id, room.hostToken, {
    action: "draw",
    expectedGameNumber: 1,
    expectedDrawCount: 0,
  });
  const before = (await getView(room.id, null, player.secret))!;
  const data = await snapshot(await db());
  const target = createClient({
    url: `file:${join(mkdtempSync(join(tmpdir(), "bingo-restored-")), "restored.db")}`,
  });
  try {
    await restoreSnapshot(target, data);
    assert.equal(
      (
        await target.execute({
          sql: "SELECT drawn FROM rooms WHERE id=?",
          args: [room.id],
        })
      ).rows[0].drawn,
      JSON.stringify(before.drawn),
    );
    assert.equal(
      (await target.execute("SELECT card FROM players")).rows[0].card,
      JSON.stringify(before.me!.card),
    );
    assert.equal(
      (await target.execute("SELECT auth_hash FROM players")).rows[0].auth_hash,
      data.tables.players[0].auth_hash,
    );
    await assert.rejects(restoreSnapshot(target, data), /empty database/);
    assert.equal(
      Number(
        (await target.execute("SELECT COUNT(*) AS n FROM players")).rows[0].n,
      ),
      1,
    );
  } finally {
    target.close();
  }
});
