import Stripe from "stripe";
import { randomUUID } from "node:crypto";
import { EVENT_PRICE } from "./game";
import { AppError } from "./errors";
import { authorizeHost, invalidateRoom } from "./service";
import { writeTransaction } from "./db";

type Sessions = Pick<Stripe["checkout"]["sessions"], "create" | "retrieve">;
type PaymentSession = Pick<
  Stripe.Checkout.Session,
  | "id"
  | "livemode"
  | "payment_status"
  | "amount_total"
  | "currency"
  | "metadata"
  | "client_reference_id"
>;

export function paymentReady() {
  try {
    const origin = new URL(process.env.APP_URL || "");
    return Boolean(
      /^[sr]k_test_/.test(process.env.STRIPE_SECRET_KEY || "") &&
      process.env.STRIPE_WEBHOOK_SECRET &&
      (origin.protocol === "https:" ||
        (process.env.NODE_ENV !== "production" &&
          ["localhost", "127.0.0.1"].includes(origin.hostname))),
    );
  } catch {
    return false;
  }
}
export function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !/^[sr]k_test_/.test(key))
    throw new AppError(
      "テスト決済はただいま準備中です。",
      503,
      "PAYMENT_NOT_READY",
    );
  return new Stripe(key, { maxNetworkRetries: 1, timeout: 8000 });
}
function matchingSession(
  session: PaymentSession,
  roomId: string,
  orderId: string,
) {
  return (
    !session.livemode &&
    session.amount_total === EVENT_PRICE &&
    session.currency === "jpy" &&
    session.client_reference_id === roomId &&
    session.metadata?.roomId === roomId &&
    session.metadata.product === "bingo_event" &&
    (session.metadata.orderId === orderId ||
      (!session.metadata.orderId && orderId === `legacy-${session.id}`))
  );
}
async function pendingOrder(roomId: string) {
  return writeTransaction(async (tx) => {
    const room = (
      await tx.execute({
        sql: "SELECT plan FROM rooms WHERE id=?",
        args: [roomId],
      })
    ).rows[0];
    if (!room || room.plan === "event")
      throw new AppError("このイベントはすでにアップグレード済みです。", 409);
    const existing = (
      await tx.execute({
        sql: "SELECT * FROM checkout_orders WHERE room_id=? AND status='pending' ORDER BY created_at DESC,rowid DESC LIMIT 1",
        args: [roomId],
      })
    ).rows[0];
    if (existing) return existing;
    const id = randomUUID();
    await tx.execute({
      sql: "INSERT INTO checkout_orders(id,room_id,amount,currency,created_at) VALUES(?,?,?,?,?)",
      args: [id, roomId, EVENT_PRICE, "jpy", Date.now()],
    });
    return (
      await tx.execute({
        sql: "SELECT * FROM checkout_orders WHERE id=?",
        args: [id],
      })
    ).rows[0];
  });
}
export async function checkout(
  id: string,
  secret: string | null,
  gateway?: Sessions,
) {
  const room = await authorizeHost(id, secret);
  if (!paymentReady())
    throw new AppError(
      "テスト決済はただいま準備中です。無料プランをご利用ください。",
      503,
      "PAYMENT_NOT_READY",
    );
  if (room.plan === "event")
    throw new AppError("このイベントはすでにアップグレード済みです。", 409);
  const sessions = gateway || stripeClient().checkout.sessions;
  for (let attempt = 0; attempt < 2; attempt++) {
    const order = await pendingOrder(id);
    let session: Stripe.Checkout.Session;
    if (order.session_id) {
      session = await sessions.retrieve(String(order.session_id));
      if (!matchingSession(session, id, String(order.id)))
        throw new AppError(
          "決済内容を確認できません。",
          409,
          "PAYMENT_MISMATCH",
        );
      if (session.status === "expired") {
        await writeTransaction(async (tx) => {
          await tx.execute({
            sql: "UPDATE checkout_orders SET status='expired' WHERE id=? AND status='pending'",
            args: [String(order.id)],
          });
        });
        continue;
      }
      if (session.status === "complete" || session.payment_status === "paid")
        throw new AppError(
          "決済結果を確認中です。画面に戻ってしばらくお待ちください。",
          409,
          "PAYMENT_PENDING",
        );
    } else {
      const origin = new URL(process.env.APP_URL!).origin;
      session = await sessions.create(
        {
          mode: "payment",
          locale: "ja",
          client_reference_id: id,
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: "jpy",
                unit_amount: EVENT_PRICE,
                product_data: {
                  name: "BINGO ROOM イベントプラン",
                  description:
                    "1イベント・最大300人・30日間利用可能（sandboxテスト）",
                },
              },
            },
          ],
          metadata: {
            roomId: id,
            orderId: String(order.id),
            product: "bingo_event",
          },
          success_url: `${origin}/host/${id}?payment=return`,
          cancel_url: `${origin}/host/${id}?payment=cancel`,
          integration_identifier: "bingo_room_mxrkptaw",
        },
        { idempotencyKey: `bingo-order-${order.id}` },
      );
    }
    if (!matchingSession(session, id, String(order.id)) || !session.url)
      throw new AppError(
        "テスト決済を開始できませんでした。",
        503,
        "PAYMENT_MISMATCH",
      );
    const url = new URL(session.url);
    if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com")
      throw new AppError("決済画面を確認できませんでした。", 503);
    await writeTransaction(async (tx) => {
      const latestRoom = (
        await tx.execute({
          sql: "SELECT plan FROM rooms WHERE id=?",
          args: [id],
        })
      ).rows[0];
      if (latestRoom?.plan === "event")
        throw new AppError(
          "決済確認が完了しました。イベント画面をご確認ください。",
          409,
          "PAYMENT_ALREADY_COMPLETE",
        );
      const current = (
        await tx.execute({
          sql: "SELECT session_id FROM checkout_orders WHERE id=?",
          args: [String(order.id)],
        })
      ).rows[0];
      if (current.session_id && current.session_id !== session.id)
        throw new AppError("決済情報が更新されています。", 409);
      await tx.execute({
        sql: "UPDATE checkout_orders SET session_id=? WHERE id=?",
        args: [session.id, String(order.id)],
      });
      await tx.execute({
        sql: "UPDATE rooms SET revision=revision+1 WHERE id=?",
        args: [id],
      });
    });
    invalidateRoom(id);
    return url.href;
  }
  throw new AppError(
    "決済画面の期限が切れました。もう一度お試しください。",
    409,
  );
}

export async function fulfillSession(session: PaymentSession) {
  if (
    session.livemode ||
    session.payment_status !== "paid" ||
    session.metadata?.product !== "bingo_event"
  )
    return false;
  const roomId = session.metadata.roomId,
    orderId = session.metadata.orderId || `legacy-${session.id}`;
  if (!roomId || !orderId || !matchingSession(session, roomId, orderId))
    throw new AppError("決済内容が一致しません。", 400, "PAYMENT_MISMATCH");
  await writeTransaction(async (tx) => {
    const order = (
      await tx.execute({
        sql: "SELECT * FROM checkout_orders WHERE id=? AND room_id=?",
        args: [orderId, roomId],
      })
    ).rows[0];
    if (
      !order ||
      Number(order.amount) !== session.amount_total ||
      order.currency !== session.currency ||
      (order.session_id && order.session_id !== session.id)
    )
      throw new AppError(
        "決済と注文の対応を確認できません。",
        409,
        "PAYMENT_MISMATCH",
      );
    if (order.status === "paid") return;
    const room = (
      await tx.execute({
        sql: "SELECT plan,expires_at FROM rooms WHERE id=?",
        args: [roomId],
      })
    ).rows[0];
    if (!room)
      throw new AppError(
        "支払済みイベントの復旧確認が必要です。",
        503,
        "PAID_ROOM_MISSING",
      );
    const now = Date.now();
    await tx.execute({
      sql: "UPDATE checkout_orders SET session_id=?,status='paid',paid_at=? WHERE id=?",
      args: [session.id, now, orderId],
    });
    await tx.execute({
      sql: "INSERT INTO payments(session_id,room_id,paid_at) VALUES(?,?,?) ON CONFLICT(session_id) DO NOTHING",
      args: [session.id, roomId, now],
    });
    if (room.plan !== "event")
      await tx.execute({
        sql: "UPDATE rooms SET plan='event',expires_at=?,revision=revision+1 WHERE id=?",
        args: [Math.max(Number(room.expires_at), now + 30 * 86400000), roomId],
      });
  });
  invalidateRoom(roomId);
  return true;
}
export async function failedSession(
  session: Pick<Stripe.Checkout.Session, "id" | "livemode" | "metadata">,
) {
  if (
    session.livemode ||
    session.metadata?.product !== "bingo_event" ||
    !session.metadata.roomId
  )
    return;
  await writeTransaction(async (tx) => {
    const result = await tx.execute({
      sql: "UPDATE checkout_orders SET status='failed',session_id=? WHERE id=? AND room_id=? AND status='pending' AND (session_id IS NULL OR session_id=?)",
      args: [
        session.id,
        session.metadata!.orderId || `legacy-${session.id}`,
        session.metadata!.roomId!,
        session.id,
      ],
    });
    if (result.rowsAffected)
      await tx.execute({
        sql: "UPDATE rooms SET revision=revision+1 WHERE id=?",
        args: [session.metadata!.roomId!],
      });
  });
  invalidateRoom(session.metadata.roomId);
}
