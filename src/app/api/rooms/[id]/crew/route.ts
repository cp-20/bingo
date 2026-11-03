import { NextRequest, NextResponse } from "next/server";
import { bearer, body, failure, noStore, sameOrigin } from "@/lib/http";
import { confirmHandover, handoverQueue } from "@/lib/handover";
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return NextResponse.json(await handoverQueue(id, bearer(request)), {
      headers: noStore,
    });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    sameOrigin(request);
    const { id } = await params,
      key = bearer(request);
    await confirmHandover(id, key, await body(request));
    return NextResponse.json(await handoverQueue(id, key), {
      headers: noStore,
    });
  } catch (error) {
    return failure(error);
  }
}
