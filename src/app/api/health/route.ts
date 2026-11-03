import { NextResponse } from "next/server";
import { noStore } from "@/lib/http";
export const runtime = "nodejs";
export async function GET() {
  return NextResponse.json({ status: "ok" }, { headers: noStore });
}
