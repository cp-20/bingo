import { NextRequest, NextResponse } from "next/server";
import { getView } from "@/lib/service";
import { bearer, failure, noStore, playerCredential } from "@/lib/http";
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
      playerCredential(request, id),
      revision === null ? undefined : Number(revision),
    );
    if (!view) return new NextResponse(null, { status: 204, headers: noStore });
    if (secret) view.paymentReady = paymentReady();
    return NextResponse.json(view, { headers: noStore });
  } catch (error) {
    return failure(error);
  }
}
