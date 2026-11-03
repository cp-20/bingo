import { NextRequest, NextResponse } from "next/server";
import { failedSession, fulfillSession, stripeClient } from "@/lib/payments";
import { AppError } from "@/lib/service";
import { failure, limitedText } from "@/lib/http";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  if (!process.env.STRIPE_WEBHOOK_SECRET)
    return NextResponse.json(
      { error: "Webhook is not configured" },
      { status: 503 },
    );
  const signature = request.headers.get("stripe-signature");
  if (!signature)
    return NextResponse.json({ error: "Signature required" }, { status: 400 });
  let raw: string;
  try {
    raw = await limitedText(request, 1024 * 1024);
  } catch (error) {
    return failure(error);
  }
  let event;
  try {
    event = stripeClient().webhooks.constructEvent(
      raw,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }
  try {
    if (event.livemode) throw new AppError("Sandbox events only", 400);
    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    )
      await fulfillSession(event.data.object);
    if (event.type === "checkout.session.async_payment_failed")
      await failedSession(event.data.object);
    return NextResponse.json({ received: true });
  } catch (error) {
    return failure(error);
  }
}
