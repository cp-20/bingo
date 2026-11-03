import { NextRequest, NextResponse } from "next/server";
import { createRoom } from "@/lib/service";
import { body, failure, sameOrigin, noStore } from "@/lib/http";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const data = await body(request);
    const room = await createRoom(
      data.title,
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        "unknown",
    );
    return NextResponse.json(room, { status: 201, headers: noStore });
  } catch (error) {
    return failure(error);
  }
}
