import { NextRequest, NextResponse } from "next/server";
import { hostAction } from "@/lib/service";
import { bearer, body, failure, sameOrigin, noStore } from "@/lib/http";
export const runtime = "nodejs";
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    sameOrigin(request);
    await hostAction(
      (await context.params).id,
      bearer(request),
      await body(request),
    );
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (error) {
    return failure(error);
  }
}
