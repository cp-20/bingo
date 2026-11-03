"use client";
export class RequestError extends Error {
  constructor(
    message: string,
    public status = 0,
    public code = "NETWORK_ERROR",
    public retryAfter = 0,
  ) {
    super(message);
  }
}
export function clientSecret() {
  return btoa(
    String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
export function savedSecret(key: string) {
  try {
    const value = localStorage.getItem(key);
    return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}
export function saveSecret(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
async function request<T>(
  url: string,
  init: RequestInit,
  read: (response: Response) => Promise<T>,
  timeout: number,
) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (init.signal?.aborted) cancel();
  init.signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(cancel, timeout);
  try {
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      let data: { error?: string; code?: string } = {};
      try {
        data = await response.json();
      } catch {
        /* A gateway may return HTML. */
      }
      throw new RequestError(
        data.error || "接続を確認できません。少し待ってからお試しください。",
        response.status,
        data.code || "HTTP_ERROR",
        Number(response.headers.get("retry-after") || 0) * 1000,
      );
    }
    return await read(response);
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(
      "通信が途切れました。操作が完了している場合があるため、最新の状態を確認してください。",
    );
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", cancel);
  }
}
export const api = <T>(
  url: string,
  init: RequestInit = {},
  timeout = 12000,
): Promise<T> =>
  request(
    url,
    init,
    async (response) => (response.status === 204 ? null : response.json()),
    timeout,
  );
export const apiBlob = (url: string, init: RequestInit = {}) =>
  request(url, init, (response) => response.blob(), 12000);

// Notify other tabs of a change without transmitting cards, messages or credentials.
export function notifyRoom(id: string) {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(`bingo-room-${id}`);
  channel.postMessage("refresh");
  channel.close();
}

export function imageSource(roomId: string, key: string) {
  return `/api/rooms/${roomId}/images/${key}`;
}
