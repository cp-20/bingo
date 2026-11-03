import { NextRequest, NextResponse } from "next/server";
import { checkout } from "@/lib/payments";
import { bearer, failure, sameOrigin, noStore } from "@/lib/http";
export const runtime = "nodejs";
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    sameOrigin(request);
    return NextResponse.json(
      { url: await checkout((await context.params).id, bearer(request)) },
      { headers: noStore },
    );
  } catch (error) {
    return failure(error);
  }
}
