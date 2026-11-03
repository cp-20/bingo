import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
process.env.TURSO_DATABASE_URL = `file:${join(mkdtempSync(join(tmpdir(), "bingo-pay-")), "test.db")}`;
process.env.APP_URL = "https://bingo.example";
process.env.STRIPE_SECRET_KEY = ["rk", "test", "fixture"].join("_");
process.env.STRIPE_WEBHOOK_SECRET = "fixture";
const { createRoom, getView, AppError } = await import("../src/lib/service");
const { db } = await import("../src/lib/db");
const { checkout, fulfillSession, failedSession, stripeClient } =
  await import("../src/lib/payments");
type Sessions = Pick<Stripe["checkout"]["sessions"], "create" | "retrieve">;

async function order(roomId: string, sessionId: string | null = null) {
  const id = randomUUID();
  await (
    await db()
  ).execute({
    sql: "INSERT INTO checkout_orders(id,room_id,session_id,amount,currency,created_at) VALUES(?,?,?,?,?,?)",
    args: [id, roomId, sessionId, 2980, "jpy", Date.now()],
  });
  return id;
}
function session(roomId: string, orderId: string, id: string) {
  return {
    id,
    livemode: false,
    payment_status: "paid" as const,
    amount_total: 2980,
    currency: "jpy",
    metadata: { roomId, orderId, product: "bingo_event" },
    client_reference_id: roomId,
  };
}
test("a paid order activates once, checks amount/currency, and does not depend on the latest session pointer", async () => {
  const room = await createRoom("Payment", "pay");
  const id = await order(room.id, "cs_fixture_1");
  const paid = session(room.id, id, "cs_fixture_1");
  assert.equal(
    await fulfillSession({ ...paid, payment_status: "unpaid" }),
    false,
  );
  assert.equal(await fulfillSession({ ...paid, livemode: true }), false);
  await assert.rejects(fulfillSession({ ...paid, amount_total: 1 }));
  await assert.rejects(fulfillSession({ ...paid, currency: "usd" }));
  await assert.rejects(fulfillSession({ ...paid, id: "cs_other" }));
  await (
    await db()
  ).execute({
    sql: "UPDATE rooms SET checkout_id=? WHERE id=?",
    args: ["another-pointer", room.id],
  });
  await fulfillSession(paid);
  const once = (await getView(room.id, null))!;
  await fulfillSession(paid);
  const twice = (await getView(room.id, null))!;
  assert.equal(once.limit, 300);
  assert.equal(twice.expiresAt, once.expiresAt);
  assert.equal(twice.revision, once.revision);
});
test("webhook can arrive before the session binding; old failure cannot downgrade a paid event", async () => {
  const room = await createRoom("Webhook first", "early");
  const id = await order(room.id);
  const paid = session(room.id, id, "cs_early");
  await (
    await db()
  ).execute({
    sql: "UPDATE rooms SET expires_at=? WHERE id=?",
    args: [Date.now() - 1000, room.id],
  });
  await fulfillSession(paid);
  await failedSession(paid);
  assert.equal((await getView(room.id, null))!.plan, "event");
  assert.equal(
    (
      await (
        await db()
      ).execute({
        sql: "SELECT status FROM checkout_orders WHERE id=?",
        args: [id],
      })
    ).rows[0].status,
    "paid",
  );
});
test("a delayed older success is still recorded after a newer order, without extending the event twice", async () => {
  const room = await createRoom("Reordering", "reorder");
  const older = await order(room.id, "cs_older");
  await failedSession(session(room.id, older, "cs_older"));
  const newer = await order(room.id, "cs_newer");
  await fulfillSession(session(room.id, newer, "cs_newer"));
  const first = (await getView(room.id, null))!;
  await fulfillSession(session(room.id, older, "cs_older"));
  const after = (await getView(room.id, null))!;
  assert.equal(after.expiresAt, first.expiresAt);
  assert.equal(
    Number(
      (
        await (
          await db()
        ).execute({
          sql: "SELECT COUNT(*) AS n FROM payments WHERE room_id=?",
          args: [room.id],
        })
      ).rows[0].n,
    ),
    2,
  );
});
test("checkout retries use one durable order and one Stripe idempotency key", async () => {
  const room = await createRoom("Checkout", "checkout");
  const keys: string[] = [];
  let calls = 0;
  const gateway = {
    create: async (
      params: Stripe.Checkout.SessionCreateParams,
      options: Stripe.RequestOptions,
    ) => {
      calls++;
      keys.push(options.idempotencyKey!);
      if (calls === 1) throw new Error("Simulated response loss");
      return {
        ...session(room.id, params.metadata!.orderId as string, "cs_retry"),
        status: "open",
        payment_status: "unpaid",
        url: "https://checkout.stripe.com/c/pay/fixture",
      };
    },
    retrieve: async () => {
      throw new Error("Not expected");
    },
  } as unknown as Sessions;
  await assert.rejects(
    checkout(room.id, room.hostToken, gateway),
    /response loss/,
  );
  await checkout(room.id, room.hostToken, gateway);
  assert.equal(keys[0], keys[1]);
  assert.equal(
    Number(
      (
        await (
          await db()
        ).execute({
          sql: "SELECT COUNT(*) AS n FROM checkout_orders WHERE room_id=?",
          args: [room.id],
        })
      ).rows[0].n,
    ),
    1,
  );
});
test("only a recorded matching order can fulfill; live keys never make a request", async () => {
  const room = await createRoom("Unknown order", "unknown-pay");
  await assert.rejects(
    fulfillSession(session(room.id, randomUUID(), "cs_unknown")),
    (e) => e instanceof AppError && e.code === "PAYMENT_MISMATCH",
  );
  const before = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = ["sk", "live", "fixture"].join("_");
  assert.throws(() => stripeClient(), /テスト決済/);
  process.env.STRIPE_SECRET_KEY = before;
  assert.equal((await getView(room.id, null))!.plan, "free");
});

test("a webhook received during checkout creation prevents another redirect to pay", async () => {
  const room = await createRoom("Already paid", "paid-early");
  const gateway = {
    create: async (params: Stripe.Checkout.SessionCreateParams) => {
      const paid = session(
        room.id,
        params.metadata!.orderId as string,
        "cs_paid_early",
      );
      await fulfillSession(paid);
      return {
        ...paid,
        status: "open",
        payment_status: "unpaid",
        url: "https://checkout.stripe.com/c/pay/fixture",
      };
    },
    retrieve: async () => {
      throw new Error("Not expected");
    },
  } as unknown as Sessions;
  await assert.rejects(
    checkout(room.id, room.hostToken, gateway),
    (error) =>
      error instanceof AppError && error.code === "PAYMENT_ALREADY_COMPLETE",
  );
  assert.equal((await getView(room.id, null))!.plan, "event");
});
