import { NextRequest, NextResponse } from "next/server";
import { getView } from "@/lib/service";
import { bearer, failure, noStore } from "@/lib/http";
import { paymentReady } from "@/lib/payments";
export const runtime = "nodejs";
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const revision = request.nextUrl.searchParams.get("revision");
    const secret = bearer(request);
    const view = await getView(
      id,
      secret,
      request.cookies.get(`bingo_${id}`)?.value,
      revision === null ? undefined : Number(revision),
    );
    if (!view) return new NextResponse(null, { status: 304, headers: noStore });
    if (secret) view.paymentReady = paymentReady();
    return NextResponse.json(view, { headers: noStore });
  } catch (error) {
    return failure(error);
  }
}
