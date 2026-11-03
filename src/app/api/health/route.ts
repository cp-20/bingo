import { NextResponse } from "next/server";
import { databaseConfigured, db } from "@/lib/db";
export const runtime = "nodejs";
export async function GET() {
  try {
    if (!databaseConfigured())
      return NextResponse.json({ status: "setup_required" }, { status: 503 });
    await (await db()).execute("SELECT 1");
    return NextResponse.json({ status: "ok", payments: "sandbox" });
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
}
