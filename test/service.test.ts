import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

process.env.TURSO_DATABASE_URL = `file:${join(mkdtempSync(join(tmpdir(), "bingo-test-")), "test.db")}`;
const { createRoom, getView, joinRoom, hostAction, printableCards, AppError } =
  await import("../src/lib/service");
const { db } = await import("../src/lib/db");

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
  // Give both fixture players the same card to exercise a guaranteed tie.
  await (
    await db()
  ).execute({
    sql: "UPDATE players SET card=? WHERE room_id=?",
    args: [JSON.stringify(before.me!.card), room.id],
  });
  const outcomes = await Promise.allSettled([
    hostAction(room.id, room.hostToken, {
      expectedGameNumber: 1,
      action: "draw",
      expectedDrawCount: 0,
    }),
    hostAction(room.id, room.hostToken, {
      expectedGameNumber: 1,
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
      expectedGameNumber: 1,
      action: "draw",
      expectedDrawCount: i,
    });
  const result = (await getView(room.id, room.hostToken))!;
  assert.equal(new Set(result.drawn).size, 75);
  assert.equal(result.winners.length, 2);
  assert.equal(result.winners[0].rank, 1);
  assert.equal(result.winners[1].rank, 1);
  await hostAction(room.id, room.hostToken, {
    expectedGameNumber: 1,
    action: "prize",
    name: "Gift",
    prizeId: randomUUID(),
  });
  const prize = (await getView(room.id, room.hostToken))!.prizes[0];
  await hostAction(room.id, room.hostToken, {
    expectedGameNumber: 1,
    action: "award",
    prizeId: prize.id,
    playerId: result.winners[0].id,
  });
  await assert.rejects(
    hostAction(room.id, room.hostToken, {
      expectedGameNumber: 1,
      action: "award",
      prizeId: prize.id,
      playerId: result.winners[1].id,
    }),
    /確認/,
  );
  await assert.rejects(
    hostAction(room.id, room.hostToken, {
      expectedGameNumber: 1,
      action: "remove_prize",
      prizeId: prize.id,
    }),
    /割り当て済み/,
  );
  await hostAction(room.id, room.hostToken, {
    expectedGameNumber: 1,
    action: "unaward",
    prizeId: prize.id,
  });
  assert.equal(
    (await getView(room.id, room.hostToken))!.prizes[0].playerId,
    null,
  );
  await hostAction(room.id, room.hostToken, {
    expectedGameNumber: 1,
    action: "remove_prize",
    prizeId: prize.id,
  });
  assert.equal((await getView(room.id, room.hostToken))!.prizes.length, 0);
  await hostAction(room.id, room.hostToken, {
    expectedGameNumber: 1,
    action: "prize",
    name: "Second gift",
    prizeId: randomUUID(),
  });
  await hostAction(room.id, room.hostToken, {
    expectedGameNumber: 1,
    action: "reset",
  });
  const reset = (await getView(room.id, null, alice.secret))!;
  assert.equal(reset.status, "lobby");
  assert.equal(reset.drawn.length, 0);
  assert.equal(reset.winners.length, 0);
  assert.deepEqual(reset.me?.card, before.me?.card);
  assert.equal(reset.prizes[0].playerId, null);
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

test("lost creation and join responses can be retried without duplicate rooms or cards", async () => {
  const secret = randomBytes(32).toString("base64url");
  const [first, second] = await Promise.all([
    createRoom("Retry", "retry-create", secret),
    createRoom("Retry", "retry-create", secret),
  ]);
  assert.deepEqual(first, second);
  await assert.rejects(createRoom("Changed", "retry-create", secret), /内容/);
  const joinKey = randomBytes(32).toString("base64url");
  const [alice, replay] = await Promise.all([
    joinRoom(first.id, "Alice", undefined, joinKey),
    joinRoom(first.id, "Alice", undefined, joinKey),
  ]);
  assert.equal(alice.secret, replay.secret);
  await hostAction(first.id, first.hostToken, {
    action: "draw",
    expectedGameNumber: 1,
    expectedDrawCount: 0,
  });
  const recovered = await joinRoom(first.id, "Alice", undefined, joinKey);
  assert.equal(recovered.secret, joinKey);
  assert.equal((await getView(first.id, null, joinKey))!.count, 1);
});
test("a stale command cannot operate on the next game", async () => {
  const room = await createRoom("Rounds", "rounds");
  await joinRoom(room.id, "Alice", undefined);
  await hostAction(room.id, room.hostToken, {
    action: "reset",
    expectedGameNumber: 1,
  });
  await assert.rejects(
    hostAction(room.id, room.hostToken, {
      action: "draw",
      expectedGameNumber: 1,
      expectedDrawCount: 0,
    }),
    (e) => e instanceof AppError && e.code === "STALE_GAME",
  );
  await assert.rejects(
    hostAction(room.id, room.hostToken, {
      action: "finish",
      expectedGameNumber: 1,
    }),
    /別のゲーム/,
  );
  await hostAction(room.id, room.hostToken, {
    action: "draw",
    expectedGameNumber: 2,
    expectedDrawCount: 0,
  });
  assert.equal((await getView(room.id, null))!.drawn.length, 1);
});
test("retrying a prize registration keeps one prize", async () => {
  const room = await createRoom("Prizes", "prize-retry");
  const command = {
    action: "prize",
    name: "Gift",
    prizeId: randomUUID(),
    expectedGameNumber: 1,
  };
  await hostAction(room.id, room.hostToken, command);
  await hostAction(room.id, room.hostToken, command);
  assert.equal((await getView(room.id, room.hostToken))!.prizes.length, 1);
  await assert.rejects(
    hostAction(room.id, room.hostToken, { ...command, name: "Other" }),
    /内容/,
  );
});

test("a creator budget does not interrupt existing events", async () => {
  const room = await createRoom("Existing room", "budget-existing");
  const key = `room-budget:${Math.floor(Date.now() / 3600000)}`;
  await (
    await db()
  ).execute({
    sql: "INSERT INTO rate_limits(key,count,expires_at) VALUES(?,100,?) ON CONFLICT(key) DO UPDATE SET count=100",
    args: [key, Date.now() + 3600000],
  });
  await assert.rejects(
    createRoom("Excess room", "another-origin"),
    (error) => error instanceof AppError && error.code === "ROOM_BUDGET_LIMIT",
  );
  assert.equal((await getView(room.id, null))!.title, "Existing room");
});
