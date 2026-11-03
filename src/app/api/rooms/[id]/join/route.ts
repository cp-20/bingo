import { NextRequest, NextResponse } from "next/server";
import { joinRoom } from "@/lib/service";
import { body, failure, sameOrigin, noStore } from "@/lib/http";
export const runtime = "nodejs";
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    sameOrigin(request);
    const { id } = await context.params;
    const data = await body(request);
    const result = await joinRoom(
      id,
      data.name,
      request.cookies.get(`bingo_${id}`)?.value,
    );
    const response = NextResponse.json({ ok: true }, { headers: noStore });
    response.cookies.set(`bingo_${id}`, result.secret, {
      httpOnly: true,
      secure:
        process.env.NODE_ENV === "production" ||
        request.nextUrl.protocol === "https:",
      sameSite: "lax",
      path: `/api/rooms/${id}`,
      maxAge: 30 * 86400,
    });
    return response;
  } catch (error) {
    return failure(error);
  }
}
