import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.TURSO_DATABASE_URL = `file:${join(mkdtempSync(join(tmpdir(), "bingo-test-")), "test.db")}`;
const { createRoom, getView, joinRoom, hostAction, printableCards, AppError } =
  await import("../src/lib/service");
const { db } = await import("../src/lib/db");
const { failedSession, fulfillSession, stripeClient } =
  await import("../src/lib/payments");

test("host authorization and player card privacy are enforced", async () => {
  const room = await createRoom("Test room", "test-privacy");
  const alice = await joinRoom(room.id, "Alice", undefined);
  const bob = await joinRoom(room.id, "Bob", undefined);
  const publicView = (await getView(room.id, null))!;
  assert.equal(publicView.players, undefined);
  assert.equal(publicView.me, undefined);
  assert.ok(!JSON.stringify(publicView).includes("auth_hash"));
  const own = (await getView(room.id, null, alice.secret))!;
  assert.equal(own.me?.name, "Alice");
  assert.equal(own.me?.card.length, 25);
  const other = (await getView(room.id, null, bob.secret))!;
  assert.equal(other.me?.name, "Bob");
  await assert.rejects(
    getView(room.id, "x".repeat(43)),
    (e: unknown) => e instanceof AppError && e.status === 401,
  );
  await assert.rejects(
    printableCards(room.id, null),
    (e: unknown) => e instanceof AppError && e.status === 401,
  );
  assert.equal((await printableCards(room.id, room.hostToken)).length, 2);
  const resumed = await joinRoom(room.id, "Alice", alice.secret);
  assert.equal(resumed.secret, alice.secret);
  assert.equal((await getView(room.id, room.hostToken))?.count, 2);
  assert.equal(await getView(room.id, null, alice.secret, own.revision), null);
});
test("free capacity and duplicate nicknames are checked on the server", async () => {
  const room = await createRoom("Capacity", "test-capacity");
  for (let i = 0; i < 30; i++)
    await joinRoom(room.id, `Player ${i}`, undefined);
  await assert.rejects(joinRoom(room.id, "Extra", undefined), /上限/);
  assert.equal((await getView(room.id, null))?.count, 30);
  const second = await createRoom("Names", "test-names");
  await joinRoom(second.id, "Ａｌｉｃｅ", undefined);
  await assert.rejects(joinRoom(second.id, "alice", undefined), /同じ名前/);
});
test("double clicks draw once; ties are ranked equally; reset preserves cards", async () => {
  const room = await createRoom("Draw test", "test-draw");
  const alice = await joinRoom(room.id, "Alice", undefined);
  const bob = await joinRoom(room.id, "Bob", undefined);
  const before = (await getView(room.id, null, alice.secret))!;
  const cards = await printableCards(room.id, room.hostToken);
  // Give both fixture players the same card to exercise a guaranteed tie.
  await (
    await db()
  ).execute({
    sql: "UPDATE players SET card=? WHERE room_id=?",
    args: [JSON.stringify(cards[0].card), room.id],
  });
  const outcomes = await Promise.allSettled([
    hostAction(room.id, room.hostToken, {
      action: "draw",
      expectedDrawCount: 0,
    }),
    hostAction(room.id, room.hostToken, {
      action: "draw",
      expectedDrawCount: 0,
    }),
  ]);
  assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 1);
  const rejected = outcomes.find((x) => x.status === "rejected");
  assert.ok(
    rejected?.status === "rejected" &&
      rejected.reason instanceof AppError &&
      rejected.reason.status === 409,
  );
  assert.equal((await getView(room.id, null))?.drawn.length, 1);
  await assert.rejects(joinRoom(room.id, "Late", undefined), /受付/);
  assert.equal((await joinRoom(room.id, "Bob", bob.secret)).secret, bob.secret);
  for (let i = 1; i < 75; i++)
    await hostAction(room.id, room.hostToken, {
      action: "draw",
      expectedDrawCount: i,
    });
  const result = (await getView(room.id, room.hostToken))!;
  assert.equal(new Set(result.drawn).size, 75);
  assert.equal(result.winners.length, 2);
  assert.equal(result.winners[0].rank, 1);
  assert.equal(result.winners[1].rank, 1);
  await hostAction(room.id, room.hostToken, { action: "prize", name: "Gift" });
  const prize = (await getView(room.id, room.hostToken))!.prizes[0];
  await hostAction(room.id, room.hostToken, {
    action: "award",
    prizeId: prize.id,
    playerId: result.winners[0].id,
  });
  await assert.rejects(
    hostAction(room.id, room.hostToken, {
      action: "award",
      prizeId: prize.id,
      playerId: result.winners[1].id,
    }),
    /確認/,
  );
  await hostAction(room.id, room.hostToken, { action: "reset" });
  const reset = (await getView(room.id, null, alice.secret))!;
  assert.equal(reset.status, "lobby");
  assert.equal(reset.drawn.length, 0);
  assert.equal(reset.winners.length, 0);
  assert.deepEqual(reset.me?.card, before.me?.card);
  assert.equal(reset.prizes[0].playerId, null);
});
test("sandbox fulfillment requires the exact paid session and is idempotent", async () => {
  const room = await createRoom("Payment test", "test-pay");
  const store = await db();
  await store.execute({
    sql: "UPDATE rooms SET checkout_id=? WHERE id=?",
    args: ["cs_test_fixture", room.id],
  });
  const session = {
    id: "cs_test_fixture",
    livemode: false,
    payment_status: "paid" as const,
    amount_total: 2980,
    currency: "jpy",
    metadata: { roomId: room.id, product: "bingo_event" },
    client_reference_id: room.id,
  };
  assert.equal(
    await fulfillSession({ ...session, payment_status: "unpaid" }),
    false,
  );
  assert.equal(await fulfillSession({ ...session, livemode: true }), false);
  await assert.rejects(fulfillSession({ ...session, amount_total: 1 }));
  await assert.rejects(fulfillSession({ ...session, currency: "usd" }));
  await assert.rejects(fulfillSession({ ...session, id: "cs_test_other" }));
  assert.equal((await getView(room.id, null))?.plan, "free");
  assert.equal(await fulfillSession(session), true);
  const once = (await getView(room.id, null))!;
  assert.equal(once.limit, 300);
  assert.equal(once.plan, "event");
  await fulfillSession(session);
  const twice = (await getView(room.id, null))!;
  assert.equal(twice.expiresAt, once.expiresAt);
  assert.equal(twice.revision, once.revision);
  assert.equal(
    Number(
      (await store.execute("SELECT COUNT(*) AS n FROM payments")).rows[0].n,
    ),
    1,
  );
});
test("live keys are refused without making any network request", () => {
  process.env.STRIPE_SECRET_KEY = ["sk", "live", "fixture"].join("_");
  assert.throws(() => stripeClient(), /テスト決済/);
  delete process.env.STRIPE_SECRET_KEY;
});
test("delayed payment can activate an expired event; failure can be retried", async () => {
  const room = await createRoom("Delayed payment", "test-delayed");
  const store = await db();
  await store.execute({
    sql: "UPDATE rooms SET checkout_id=? WHERE id=?",
    args: ["cs_test_failed", room.id],
  });
  await failedSession({
    id: "cs_test_other",
    livemode: false,
    metadata: { roomId: room.id, product: "bingo_event" },
  });
  assert.equal(
    (
      await store.execute({
        sql: "SELECT checkout_id FROM rooms WHERE id=?",
        args: [room.id],
      })
    ).rows[0].checkout_id,
    "cs_test_failed",
  );
  await failedSession({
    id: "cs_test_failed",
    livemode: false,
    metadata: { roomId: room.id, product: "bingo_event" },
  });
  const afterFailure = (
    await store.execute({
      sql: "SELECT checkout_id,checkout_version FROM rooms WHERE id=?",
      args: [room.id],
    })
  ).rows[0];
  assert.equal(afterFailure.checkout_id, null);
  assert.equal(Number(afterFailure.checkout_version), 1);
  await store.execute({
    sql: "UPDATE rooms SET checkout_id=?,expires_at=? WHERE id=?",
    args: ["cs_test_delayed", Date.now() - 1000, room.id],
  });
  await fulfillSession({
    id: "cs_test_delayed",
    livemode: false,
    payment_status: "paid",
    amount_total: 2980,
    currency: "jpy",
    metadata: { roomId: room.id, product: "bingo_event" },
    client_reference_id: room.id,
  });
  const view = (await getView(room.id, null))!;
  assert.equal(view.plan, "event");
  assert.ok(view.expiresAt > Date.now() + 29 * 86400000);
});
test("event plan accepts exactly 300 players", async () => {
  const room = await createRoom("Large event", "test-large");
  await (
    await db()
  ).execute({
    sql: "UPDATE rooms SET plan='event' WHERE id=?",
    args: [room.id],
  });
  for (let i = 0; i < 300; i++)
    await joinRoom(room.id, `Guest ${i}`, undefined);
  await assert.rejects(joinRoom(room.id, "Guest 301", undefined), /上限/);
  const view = (await getView(room.id, null))!;
  assert.equal(view.count, 300);
  assert.equal(view.limit, 300);
  const unchanged = await Promise.all(
    Array.from({ length: 100 }, () =>
      getView(room.id, null, undefined, view.revision),
    ),
  );
  assert.ok(unchanged.every((value) => value === null));
});
test("event creation has a bounded per-origin rate", async () => {
  for (let i = 0; i < 10; i++) await createRoom(`Room ${i}`, "test-rate");
  await assert.rejects(
    createRoom("Extra", "test-rate"),
    (error: unknown) => error instanceof AppError && error.status === 429,
  );
});
test("simultaneous joins cannot exceed the free capacity", async () => {
  const room = await createRoom("Concurrent join", "test-concurrent");
  const results = await Promise.allSettled(
    Array.from({ length: 40 }, (_, i) =>
      joinRoom(room.id, `Person ${i}`, undefined),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 30);
  assert.equal((await getView(room.id, null))?.count, 30);
  for (const result of results)
    if (result.status === "rejected")
      assert.ok(
        result.reason instanceof AppError && result.reason.status === 409,
      );
});
