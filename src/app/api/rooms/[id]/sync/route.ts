import { NextRequest, NextResponse } from "next/server";
import { bearer, failure, noStore, playerCredential } from "@/lib/http";
import { getView } from "@/lib/service";
import { getCommunity } from "@/lib/community";
import { paymentReady } from "@/lib/payments";
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params,
      host = bearer(request),
      player = playerCredential(request, id);
    const revision =
        Number(request.nextUrl.searchParams.get("revision")) || undefined,
      liveRevision =
        Number(request.nextUrl.searchParams.get("liveRevision")) || undefined;
    const [room, live] = await Promise.all([
      getView(
        id,
        host,
        player,
        revision,
        request.nextUrl.searchParams.get("view") === "card",
      ),
      getCommunity(id, host, player, liveRevision),
    ]);
    if (host && room) room.paymentReady = paymentReady();
    return room || live
      ? NextResponse.json({ room, live }, { headers: noStore })
      : new NextResponse(null, { status: 204, headers: noStore });
  } catch (error) {
    return failure(error);
  }
}
