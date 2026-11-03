import { NextRequest, NextResponse } from "next/server";
import { getView, printableCards } from "@/lib/service";
import { bearer, failure, noStore } from "@/lib/http";
import { csvCell } from "@/lib/game";
export const runtime = "nodejs";
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const secret = bearer(request);
    if (request.nextUrl.searchParams.get("format") === "cards")
      return NextResponse.json(await printableCards(id, secret), {
        headers: noStore,
      });
    // getView validates a supplied host token; an absent token is not authorization.
    if (!secret)
      return NextResponse.json(
        { error: "幹事用リンクから開いてください。" },
        { status: 401, headers: noStore },
      );
    const room = await getView(id, secret);
    const rows = [
      ["名前", "順位", "ビンゴした抽選回", "景品"],
      ...(room?.players || []).map((p) => [
        p.name,
        p.rank ?? "",
        p.bingoAt ?? "",
        room?.prizes.find((prize) => prize.playerId === p.id)?.name || "",
      ]),
    ];
    return new NextResponse(
      "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n"),
      {
        headers: {
          ...noStore,
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="bingo-${id}.csv"`,
        },
      },
    );
  } catch (error) {
    return failure(error);
  }
}
