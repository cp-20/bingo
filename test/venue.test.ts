import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
process.env.TURSO_DATABASE_URL = `file:${join(mkdtempSync(join(tmpdir(), "bingo-venue-")), "app.db")}`;
const { createRoom, joinRoom, getView, hostAction, invalidateRoom } =
  await import("../src/lib/service");
const { getCommunity, communityAction } = await import("../src/lib/community");
const { handoverQueue, confirmHandover } = await import("../src/lib/handover");
const { putPrizeImage, prizeImage } = await import("../src/lib/prize-images");
const { db } = await import("../src/lib/db");
async function event(name: string) {
  const room = await createRoom(name, name);
  const alice = await joinRoom(room.id, "Alice", undefined),
    bob = await joinRoom(room.id, "Bob", undefined);
  const act = (input: Record<string, unknown>) =>
    hostAction(room.id, room.hostToken, { expectedGameNumber: 1, ...input });
  return { ...room, alice, bob, act };
}
async function win(id: string) {
  await (
    await db()
  ).execute({
    sql: "UPDATE players SET bingo_at=1 WHERE room_id=?",
    args: [id],
  });
  invalidateRoom(id);
}

test("chat is authenticated, idempotent, rate limited, and only selected posts reach the screen", async () => {
  const r = await event("Conversation");
  const before = (await getView(r.id, null))!;
  await assert.rejects(
    communityAction(r.id, null, undefined, {
      action: "message",
      messageId: randomUUID(),
      body: "guest",
    }),
    /参加/,
  );
  const post = {
    action: "message",
    messageId: randomUUID(),
    body: "景品がほしい <b>文字もそのまま</b> 🎉",
  };
  await communityAction(r.id, null, r.alice.secret, post);
  await communityAction(r.id, null, r.alice.secret, post);
  const own = (await getCommunity(r.id, null, r.alice.secret))!;
  assert.equal(own.messages.length, 1);
  assert.equal(own.messages[0].name, "Alice");
  assert.equal(own.messages[0].body, post.body);
  assert.deepEqual((await getCommunity(r.id, null))!.messages, []);
  assert.equal((await getCommunity(r.id, null))!.pinned, null);
  assert.equal((await getView(r.id, null))!.revision, before.revision);
  await assert.rejects(
    communityAction(r.id, null, r.alice.secret, {
      action: "pin",
      messageId: post.messageId,
    }),
    /幹事/,
  );
  await communityAction(r.id, r.hostToken, undefined, {
    action: "pin",
    messageId: post.messageId,
  });
  assert.equal((await getCommunity(r.id, null))!.pinned?.id, post.messageId);
  await communityAction(r.id, r.hostToken, undefined, {
    action: "hide",
    messageId: post.messageId,
  });
  assert.equal((await getCommunity(r.id, null))!.pinned, null);
  await communityAction(r.id, r.hostToken, undefined, {
    action: "pause",
    enabled: false,
  });
  await assert.rejects(
    communityAction(r.id, null, r.alice.secret, {
      ...post,
      messageId: randomUUID(),
    }),
    /お休み/,
  );
  await communityAction(r.id, r.hostToken, undefined, {
    action: "pause",
    enabled: true,
  });
  for (let i = 0; i < 2; i++)
    await communityAction(r.id, null, r.alice.secret, {
      action: "message",
      messageId: randomUUID(),
      body: "応援" + i,
    });
  await assert.rejects(
    communityAction(r.id, null, r.alice.secret, {
      action: "message",
      messageId: randomUUID(),
      body: "追加",
    }),
    /間を/,
  );
  await assert.rejects(
    communityAction(r.id, null, r.bob.secret, {
      action: "message",
      messageId: randomUUID(),
      body: "あ".repeat(141),
    }),
    /140/,
  );
});
test("an old pinned post survives the chat window and reactions cannot be inflated by retries", async () => {
  const r = await event("Pinned");
  const id = randomUUID();
  await communityAction(r.id, r.hostToken, undefined, {
    action: "message",
    messageId: id,
    body: "長く残す案内",
  });
  await communityAction(r.id, r.hostToken, undefined, {
    action: "pin",
    messageId: id,
  });
  await (
    await db()
  ).batch(
    Array.from({ length: 70 }, (_, i) => ({
      sql: "INSERT INTO messages VALUES(?,?,?,?,?,?,?,?)",
      args: [
        randomUUID(),
        r.id,
        "fixture",
        "Bob",
        `投稿${i}`,
        0,
        0,
        Date.now() + i + 100,
      ],
    })),
    "write",
  );
  // A write invalidates any cached feed before reading the newly inserted fixtures.
  await communityAction(r.id, r.hostToken, undefined, {
    action: "pause",
    enabled: true,
  });
  assert.equal((await getCommunity(r.id, null))!.pinned?.body, "長く残す案内");
  const input = {
    action: "reaction",
    kind: "clap",
    gameNumber: 1,
    drawCount: 0,
  };
  for (let i = 0; i < 3; i++)
    await communityAction(r.id, null, r.alice.secret, input);
  assert.equal((await getCommunity(r.id, null))!.reactions.clap, 1);
  await r.act({ action: "draw", expectedDrawCount: 0 });
  assert.equal((await getCommunity(r.id, null))!.reactions.clap, 0);
  await assert.rejects(
    communityAction(r.id, null, r.alice.secret, input),
    /新しい番号/,
  );
});
test("photos are authorized, orientation-corrected and reencoded; a failed replacement retains the old photo", async () => {
  const r = await event("Images"),
    prizeId = randomUUID();
  await r.act({ action: "prize", prizeId, name: "Gift" });
  const input = await sharp({
    create: { width: 800, height: 400, channels: 3, background: "red" },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  await assert.rejects(putPrizeImage(r.id, null, prizeId, input), /幹事/);
  const key = await putPrizeImage(r.id, r.hostToken, prizeId, input),
    image = await prizeImage(r.id, key),
    info = await sharp(image).metadata();
  assert.equal(info.format, "jpeg");
  assert.ok(info.height! > info.width!);
  assert.equal(info.orientation, undefined);
  assert.equal(info.exif, undefined);
  await assert.rejects(
    putPrizeImage(r.id, r.hostToken, prizeId, Buffer.from("<svg/>")),
    /写真/,
  );
  assert.equal((await getView(r.id, null))!.prizes[0].imageKey, key);
  const other = await event("Other images");
  await assert.rejects(prizeImage(other.id, key), /見つかりません/);
});
test("private claim codes and crew permissions survive a new game; concurrent handovers have one winner", async () => {
  const r = await event("Handover");
  await win(r.id);
  const own = (await getView(r.id, null, r.alice.secret))!,
    playerId = own.me!.id,
    prizeId = randomUUID();
  await r.act({ action: "prize", prizeId, name: "Coffee" });
  await r.act({ action: "award", prizeId, playerId });
  const receipt = (await getView(r.id, null, r.alice.secret))!.receipts![0],
    host = (await getView(r.id, r.hostToken))!,
    crew = host.crewKey!;
  assert.match(receipt.claimCode, /^\d{6}$/);
  assert.equal((await getView(r.id, null, r.bob.secret))!.receipts!.length, 0);
  assert.ok(
    !JSON.stringify(await getView(r.id, null)).includes(receipt.claimCode),
  );
  await assert.rejects(getView(r.id, crew), /幹事/);
  await assert.rejects(handoverQueue(r.id, r.hostToken), /景品係/);
  assert.ok(
    !JSON.stringify(await handoverQueue(r.id, crew)).includes(
      receipt.claimCode,
    ),
  );
  await r.act({ action: "reset" });
  const next = (await getView(r.id, null, r.alice.secret))!;
  assert.equal(next.gameNumber, 2);
  assert.equal(next.prizes[0].playerId, playerId);
  assert.equal(next.receipts![0].id, receipt.id);
  const command = {
    awardId: receipt.id,
    playerId,
    claimCode: receipt.claimCode,
    expectedDeliveredAt: null,
  };
  await assert.rejects(
    confirmHandover(r.id, crew, { ...command, claimCode: "000000" }),
    /6桁/,
  );
  const outcomes = await Promise.allSettled([
    confirmHandover(r.id, crew, command),
    confirmHandover(r.id, crew, command),
  ]);
  assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
  const delivered = (await getView(r.id, null, r.alice.secret))!.receipts![0];
  assert.ok(delivered.deliveredAt);
  await assert.rejects(
    hostAction(r.id, r.hostToken, {
      action: "unaward",
      prizeId,
      expectedAwardId: receipt.id,
      expectedGameNumber: 2,
    }),
    /受け渡し済み/,
  );
  await confirmHandover(r.id, crew, {
    awardId: receipt.id,
    playerId,
    expectedDeliveredAt: delivered.deliveredAt,
    undo: true,
  });
  assert.equal(
    (await getView(r.id, null, r.alice.secret))!.receipts![0].deliveredAt,
    null,
  );
});
test("a stale host cannot cancel a new recipient and finishing always closes the show", async () => {
  const r = await event("Stale award");
  await win(r.id);
  const players = (await getView(r.id, r.hostToken))!.players!,
    prizeId = randomUUID();
  await r.act({ action: "prize", prizeId, name: "Gift" });
  await r.act({ action: "award", prizeId, playerId: players[0].id });
  const old = (await getView(r.id, r.hostToken))!.prizes[0].awardId;
  await r.act({ action: "unaward", prizeId, expectedAwardId: old });
  await r.act({ action: "award", prizeId, playerId: players[1].id });
  await assert.rejects(
    r.act({ action: "unaward", prizeId, expectedAwardId: old }),
    /変更/,
  );
  assert.equal((await getView(r.id, null))!.prizes[0].playerId, players[1].id);
  await r.act({ action: "finish" });
  const result = (await getView(r.id, null))!;
  assert.equal(result.status, "finished");
  assert.equal(result.stage, null);
});
