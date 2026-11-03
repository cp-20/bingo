import Stripe from "stripe";
import { EVENT_PRICE } from "./game";
import { AppError, authorizeHost, upgradeRoom } from "./service";
import { db } from "./db";

export function paymentReady() {
  return Boolean(
    /^[sr]k_test_/.test(process.env.STRIPE_SECRET_KEY || "") &&
    process.env.STRIPE_WEBHOOK_SECRET &&
    process.env.APP_URL,
  );
}
export function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !/^[sr]k_test_/.test(key))
    throw new AppError("テスト決済はただいま準備中です。", 503);
  return new Stripe(key, { maxNetworkRetries: 2, timeout: 15000 });
}
export async function checkout(id: string, secret: string | null) {
  const room = await authorizeHost(id, secret);
  if (!paymentReady())
    throw new AppError(
      "テスト決済はただいま準備中です。無料プランをご利用ください。",
      503,
    );
  if (room.plan === "event")
    throw new AppError("このイベントはすでにアップグレード済みです。", 409);
  const stripe = stripeClient();
  if (room.checkout_id) {
    const old = await stripe.checkout.sessions.retrieve(
      String(room.checkout_id),
    );
    if (old.status === "open" && old.url) return old.url;
    if (old.payment_status === "paid" || old.status === "complete")
      throw new AppError("決済結果を確認中です。しばらくお待ちください。", 409);
  }
  const origin = new URL(process.env.APP_URL!).origin;
  const session = await stripe.checkout.sessions.create(
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
      metadata: { roomId: id, product: "bingo_event" },
      success_url: `${origin}/host/${id}?payment=return`,
      cancel_url: `${origin}/host/${id}?payment=cancel`,
      integration_identifier: "bingo_room_mxrkptaw",
    },
    {
      idempotencyKey: `bingo-${id}-${room.checkout_version}-${room.checkout_id || "first"}`,
    },
  );
  if (!session.url || session.livemode)
    throw new AppError("テスト決済を開始できませんでした。", 503);
  await (
    await db()
  ).execute({
    sql: "UPDATE rooms SET checkout_id=? WHERE id=? AND plan='free'",
    args: [session.id, id],
  });
  return session.url;
}

export async function fulfillSession(
  session: Pick<
    Stripe.Checkout.Session,
    | "id"
    | "livemode"
    | "payment_status"
    | "amount_total"
    | "currency"
    | "metadata"
    | "client_reference_id"
  >,
) {
  if (session.livemode || session.payment_status !== "paid") return false;
  if (
    session.amount_total !== EVENT_PRICE ||
    session.currency !== "jpy" ||
    session.metadata?.product !== "bingo_event" ||
    session.metadata.roomId !== session.client_reference_id
  )
    throw new AppError("決済内容が一致しません。", 400);
  await upgradeRoom(session.metadata.roomId, session.id);
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
  await (
    await db()
  ).execute({
    sql: "UPDATE rooms SET checkout_id=NULL,checkout_version=checkout_version+1,revision=revision+1 WHERE id=? AND checkout_id=? AND plan='free'",
    args: [session.metadata.roomId, session.id],
  });
}
