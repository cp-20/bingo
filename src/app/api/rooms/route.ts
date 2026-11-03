import { NextRequest, NextResponse } from "next/server";
import { createRoom, validSecret, AppError } from "@/lib/service";
import { body, failure, sameOrigin, noStore } from "@/lib/http";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const data = await body(request);
    const creationKey = request.headers.get("idempotency-key");
    if (!validSecret(creationKey))
      throw new AppError("作成画面を開き直してお試しください。");
    const room = await createRoom(
      data.title,
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        "unknown",
      creationKey,
    );
    return NextResponse.json(room, { status: 201, headers: noStore });
  } catch (error) {
    return failure(error);
  }
}
