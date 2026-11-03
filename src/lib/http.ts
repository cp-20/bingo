import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { AppError } from "./errors";

export function bearer(request: NextRequest) {
  const header = request.headers.get("authorization");
  if (header === null) return null;
  if (!/^Bearer [A-Za-z0-9_-]{43}$/.test(header))
    throw new AppError(
      "幹事用リンクを確認してください。",
      401,
      "INVALID_HOST_KEY",
    );
  return header.slice(7);
}
export function playerCredential(request: NextRequest, roomId: string) {
  const value =
    request.headers.get("x-player-key") ||
    request.cookies.get(`bingo_${roomId}`)?.value;
  if (value && !/^[A-Za-z0-9_-]{43}$/.test(value))
    throw new AppError(
      "カードの復帰リンクを確認してください。",
      401,
      "INVALID_PLAYER_KEY",
    );
  return value;
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
  if (error instanceof AppError) {
    if (error.status >= 500)
      console.error(
        JSON.stringify({
          event: "api_error",
          code: error.code,
          status: error.status,
        }),
      );
    return NextResponse.json(
      { error: error.message, code: error.code },
      {
        status: error.status,
        headers: {
          ...noStore,
          ...(error.status === 503 || error.status === 429
            ? { "Retry-After": String(error.retryAfter) }
            : {}),
        },
      },
    );
  }
  if (error instanceof Error && error.message === "DATABASE_NOT_CONFIGURED")
    return NextResponse.json(
      { error: "ただいま準備中です。公開までしばらくお待ちください。" },
      { status: 503, headers: { ...noStore, "Retry-After": "30" } },
    );
  if (error instanceof Error && /^(名前は|名前を)/.test(error.message))
    return NextResponse.json(
      { error: error.message },
      { status: 400, headers: noStore },
    );
  // Do not expose database URLs, payment objects, or credentials in responses/logs.
  const requestId = randomUUID();
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
          .replace(/[^A-Z_0-9]/g, "")
          .slice(0, 40)
      : "UNEXPECTED";
  console.error(
    JSON.stringify({ event: "api_error", requestId, code, status: 503 }),
  );
  return NextResponse.json(
    {
      error: "接続が不安定です。少し待ってからもう一度お試しください。",
      requestId,
    },
    {
      status: 503,
      headers: { ...noStore, "Retry-After": "5", "X-Request-Id": requestId },
    },
  );
}
export const noStore = { "Cache-Control": "private, no-store, max-age=0" };
