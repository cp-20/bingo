import { NextRequest, NextResponse } from "next/server";
import { AppError } from "./service";

export function bearer(request: NextRequest) {
  const header = request.headers.get("authorization");
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}
export function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const expected = process.env.APP_URL
    ? new URL(process.env.APP_URL).origin
    : request.nextUrl.origin;
  if (origin !== expected)
    throw new AppError("この操作はイベント画面から行ってください。", 403);
}
export async function body(request: NextRequest) {
  const raw = await limitedText(request, 8192);
  let result: unknown;
  try {
    result = JSON.parse(raw);
  } catch {
    throw new AppError("入力を確認してください。");
  }
  if (!result || typeof result !== "object" || Array.isArray(result))
    throw new AppError("入力を確認してください。");
  return result as Record<string, unknown>;
}
export async function limitedText(request: NextRequest, maxBytes: number) {
  if (Number(request.headers.get("content-length")) > maxBytes)
    throw new AppError("入力が長すぎます。", 413);
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new AppError("入力が長すぎます。", 413);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    reader.releaseLock();
  }
}
export function failure(error: unknown) {
  if (error instanceof AppError)
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  if (error instanceof Error && error.message === "DATABASE_NOT_CONFIGURED")
    return NextResponse.json(
      { error: "ただいま準備中です。公開までしばらくお待ちください。" },
      { status: 503 },
    );
  if (error instanceof Error && /^(名前は|名前を)/.test(error.message))
    return NextResponse.json({ error: error.message }, { status: 400 });
  // Do not expose database URLs, payment objects, or credentials in responses/logs.
  console.error(
    "Request failed",
    error instanceof Error ? error.name : "UnknownError",
  );
  return NextResponse.json(
    { error: "接続が不安定です。少し待ってからもう一度お試しください。" },
    { status: 503 },
  );
}
export const noStore = { "Cache-Control": "private, no-store, max-age=0" };
