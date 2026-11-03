import { NextRequest, NextResponse } from "next/server";
import { bearer, failure, limitedBytes, noStore, sameOrigin } from "@/lib/http";
import { getView } from "@/lib/service";
import { putPrizeImage } from "@/lib/prize-images";
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    sameOrigin(request);
    const { id } = await params,
      key = bearer(request);
    const imageKey = await putPrizeImage(
      id,
      key,
      request.nextUrl.searchParams.get("prizeId") || "",
      await limitedBytes(request, 512 * 1024),
    );
    return NextResponse.json(
      { imageKey, room: await getView(id, key) },
      { headers: noStore },
    );
  } catch (error) {
    return failure(error);
  }
}
