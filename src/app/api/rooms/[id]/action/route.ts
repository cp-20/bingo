import { NextRequest, NextResponse } from "next/server";
import { getView, hostAction } from "@/lib/service";
import { paymentReady } from "@/lib/payments";
import { bearer, body, failure, sameOrigin, noStore } from "@/lib/http";
export const runtime = "nodejs";
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    sameOrigin(request);
    const { id } = await context.params;
    const secret = bearer(request);
    await hostAction(id, secret, await body(request));
    const room = await getView(id, secret);
    if (room) room.paymentReady = paymentReady();
    return NextResponse.json({ room }, { headers: noStore });
  } catch (error) {
    return failure(error);
  }
}
