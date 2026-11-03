import { NextRequest, NextResponse } from "next/server";
import {
  bearer,
  body,
  failure,
  noStore,
  playerCredential,
  sameOrigin,
} from "@/lib/http";
import { communityAction, getCommunity } from "@/lib/community";
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    sameOrigin(request);
    const { id } = await params,
      host = bearer(request),
      player = playerCredential(request, id);
    await communityAction(id, host, player, await body(request));
    return NextResponse.json(
      { live: await getCommunity(id, host, player) },
      { headers: noStore },
    );
  } catch (error) {
    return failure(error);
  }
}
