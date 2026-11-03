import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
test(
  "a silent database transport is cancelled within the request budget",
  { timeout: 15000 },
  async () => {
    let requests = 0;
    const server = createServer(() => {
      requests++;
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    process.env.TURSO_DATABASE_URL = `http://127.0.0.1:${address.port}`;
    const { db } = await import("../src/lib/db");
    const started = performance.now();
    try {
      await assert.rejects(db());
      assert.ok(requests > 0);
      assert.ok(performance.now() - started < 12000);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  },
);
