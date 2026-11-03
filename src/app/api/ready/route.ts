import { NextResponse } from "next/server";
import { db, SCHEMA_VERSION } from "@/lib/db";
import { noStore } from "@/lib/http";
export const runtime = "nodejs";
export async function GET() {
  try {
    const result = await (
      await db()
    ).execute("SELECT MAX(version) AS version FROM schema_migrations");
    if (Number(result.rows[0].version) !== SCHEMA_VERSION)
      throw new Error("SCHEMA_NOT_READY");
    return NextResponse.json(
      { status: "ready", payments: "sandbox" },
      { headers: noStore },
    );
  } catch {
    return NextResponse.json(
      { status: "unavailable" },
      { status: 503, headers: { ...noStore, "Retry-After": "10" } },
    );
  }
}
