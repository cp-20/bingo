import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@libsql/client";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate, SCHEMA_VERSION } from "../src/lib/db";
test("v1 data survives concurrent upgrades, including a legacy pending checkout", async () => {
  const url = `file:${join(mkdtempSync(join(tmpdir(), "bingo-migrate-")), "test.db")}`;
  const first = createClient({ url }),
    second = createClient({ url });
  try {
    await first.executeMultiple(`PRAGMA journal_mode=WAL;
      CREATE TABLE rooms(id TEXT PRIMARY KEY,host_hash TEXT,title TEXT,status TEXT,plan TEXT,drawn TEXT,prizes TEXT,created_at INTEGER,expires_at INTEGER,revision INTEGER,checkout_id TEXT,checkout_version INTEGER);
      INSERT INTO rooms VALUES('ABCD2345','private-hash','Existing event','playing','free','[7,12]','[]',1,9999999999999,4,'cs_legacy',0);
      CREATE TABLE players(id TEXT PRIMARY KEY,room_id TEXT,auth_hash TEXT,name TEXT,name_key TEXT,card TEXT,bingo_at INTEGER,joined_at INTEGER,UNIQUE(room_id,name_key));
      INSERT INTO players VALUES('player','ABCD2345','card-hash','Alice','alice','[1,2,3]',NULL,1);`);
    await Promise.all([migrate(first), migrate(second)]);
    const row = (await first.execute("SELECT * FROM rooms")).rows[0];
    assert.equal(row.title, "Existing event");
    assert.equal(row.host_hash, "private-hash");
    assert.equal(row.drawn, "[7,12]");
    assert.equal(Number(row.game_number), 1);
    assert.equal(
      (await first.execute("SELECT auth_hash FROM players")).rows[0].auth_hash,
      "card-hash",
    );
    assert.equal(
      (await first.execute("SELECT session_id FROM checkout_orders")).rows[0]
        .session_id,
      "cs_legacy",
    );
    assert.equal(
      Number(
        (await first.execute("SELECT MAX(version) AS n FROM schema_migrations"))
          .rows[0].n,
      ),
      SCHEMA_VERSION,
    );
    await migrate(first);
    assert.equal(
      Number(
        (await first.execute("SELECT COUNT(*) AS n FROM rooms")).rows[0].n,
      ),
      1,
    );
  } finally {
    first.close();
    second.close();
  }
});
