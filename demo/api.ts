import type { Card, Player, Room, RoomView } from "../src/lib/game";
import { cardStatus } from "../src/lib/card";
import { clientSecret, RequestError } from "../src/lib/client";
export {
  clientSecret,
  savedSecret,
  saveSecret,
  RequestError,
} from "../src/lib/client";

export const DEMO_ID = "DEMO8888";
const storage = "bingo-room-demo-v1";
type Guest = Player & { card: Card; secret: string };
type State = Room & { hostKey: string; guests: Guest[] };

function card(): Card {
  const columns = Array.from({ length: 5 }, (_, column) => {
    const values = Array.from({ length: 15 }, (_, i) => column * 15 + i + 1);
    for (let i = 14; i > 0; i--) {
      const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
      [values[i], values[j]] = [values[j], values[i]];
    }
    return values.slice(0, 5);
  });
  const values = Array.from(
    { length: 25 },
    (_, i) => columns[i % 5][Math.floor(i / 5)],
  );
  values[12] = 0;
  return values;
}
export function resetDemo(title = "みんなで忘年会 2026") {
  const now = Date.now(),
    hostKey = clientSecret();
  const guests = [
    "あなた",
    "さくら",
    "田中さん",
    "ビンゴ太郎",
    "あおい",
    "山田さん",
  ].map((name) => ({
    id: crypto.randomUUID(),
    name,
    secret: clientSecret(),
    card: card(),
    bingoAt: null,
    rank: null,
  }));
  const state: State = {
    id: DEMO_ID,
    title,
    hostKey,
    guests,
    status: "lobby",
    plan: "free",
    drawn: [],
    prizes: [],
    createdAt: now,
    expiresAt: now + 7 * 86400000,
    revision: 1,
    gameNumber: 1,
  };
  localStorage.setItem(storage, JSON.stringify(state));
  localStorage.setItem(`bingo-host-${DEMO_ID}`, hostKey);
  localStorage.setItem(`bingo-player-${DEMO_ID}`, guests[0].secret);
  return state;
}
function read(): State {
  try {
    const value = JSON.parse(localStorage.getItem(storage) || "null");
    if (
      value?.id === DEMO_ID &&
      Array.isArray(value.guests) &&
      Array.isArray(value.drawn)
    )
      return value;
  } catch {
    /* Reset only the isolated demo state after a format change. */
  }
  return resetDemo();
}
export function prepareDemo() {
  read();
}
export function previewBingo() {
  const state = read();
  state.guests[0].card = [
    7, 19, 34, 49, 65, 11, 22, 38, 52, 70, 3, 27, 0, 55, 62, 14, 16, 41, 47, 73,
    9, 24, 43, 58, 68,
  ];
  state.drawn = state.guests[0].card.slice(0, 4);
  state.status = "playing";
  state.guests.forEach((guest) => {
    guest.bingoAt = null;
    guest.rank = null;
  });
  state.prizes.forEach((prize) => {
    prize.playerId = null;
  });
  state.revision++;
  const revision = state.revision;
  localStorage.setItem(storage, JSON.stringify(state));
  window.dispatchEvent(new Event("online"));
  window.setTimeout(() => {
    const latest = read();
    // A manual draw or reset takes precedence over this isolated preview.
    if (latest.revision !== revision || latest.gameNumber !== state.gameNumber)
      return;
    latest.drawn.push(65);
    latest.guests.forEach((guest) => {
      if (cardStatus(guest.card, latest.drawn).bingo)
        guest.bingoAt = latest.drawn.length;
    });
    rank(latest);
    latest.revision++;
    localStorage.setItem(storage, JSON.stringify(latest));
    window.dispatchEvent(new Event("online"));
  }, 900);
}
function view(state: State, headers: Headers): RoomView {
  const { hostKey, guests, ...room } = state;
  const players = guests.map(
    ({ secret: _secret, card: _card, ...player }) => player,
  );
  const host = headers.get("authorization") === `Bearer ${hostKey}`;
  const own = guests.find(
    (guest) => guest.secret === headers.get("x-player-key"),
  );
  return {
    ...room,
    count: guests.length,
    limit: room.plan === "event" ? 300 : 30,
    winners: players
      .filter((p) => p.bingoAt !== null)
      .sort((a, b) => a.bingoAt! - b.bingoAt!),
    ...(host ? { players, paymentReady: false, paymentStatus: "none" } : {}),
    ...(own
      ? {
          me: players.find((player) => player.id === own.id) && {
            ...players.find((player) => player.id === own.id)!,
            card: own.card,
          },
        }
      : {}),
  };
}
function fail(message: string, status = 409): never {
  throw new RequestError(message, status, "DEMO_STATE");
}
function name(value: unknown, max = 20) {
  if (typeof value !== "string") fail("名前を入力してください。", 400);
  const result = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  if (!result || [...result].length > max)
    fail(`名前は1〜${max}文字で入力してください。`, 400);
  return result;
}
function rank(state: State) {
  const winners = state.guests
    .filter((g) => g.bingoAt !== null)
    .sort((a, b) => a.bingoAt! - b.bingoAt!);
  let previous = -1,
    position = 0;
  winners.forEach((guest, index) => {
    if (guest.bingoAt !== previous) position = index + 1;
    previous = guest.bingoAt!;
    guest.rank = position;
  });
}
function dispatch(url: string, init: RequestInit) {
  const parsed = new URL(url, location.origin),
    headers = new Headers(init.headers);
  if (parsed.origin !== location.origin)
    fail("デモから外部サービスには接続しません。", 400);
  if (parsed.pathname === "/api/ready") return { status: "ready" };
  if (parsed.pathname === "/api/rooms" && init.method === "POST") {
    const input = JSON.parse(String(init.body));
    const state = resetDemo(name(input.title, 40));
    return { id: state.id, hostToken: state.hostKey };
  }
  if (!parsed.pathname.startsWith(`/api/rooms/${DEMO_ID}`))
    fail("体験デモでは、このサンプル会場をご利用ください。", 404);
  const state = read(),
    host = headers.get("authorization") === `Bearer ${state.hostKey}`;
  const suffix = parsed.pathname.slice(`/api/rooms/${DEMO_ID}`.length);
  if (suffix === "/export") {
    if (!host) fail("幹事画面から開いてください。", 401);
    return state.guests.map(({ id, name, card }) => ({ id, name, card }));
  }
  if (suffix === "/checkout") fail("体験デモでは決済は行いません。", 503);
  if (suffix === "/join" && init.method === "POST") {
    const input = JSON.parse(String(init.body));
    let guest = state.guests.find((g) => g.secret === input.joinKey);
    if (!guest) {
      if (state.status !== "lobby") fail("新規参加の受付は終了しました。");
      const nickname = name(input.name);
      if (
        state.guests.some(
          (g) =>
            g.name.toLocaleLowerCase("ja") === nickname.toLocaleLowerCase("ja"),
        )
      )
        fail("同じ名前で参加している人がいます。");
      if (state.guests.length >= 30) fail("参加人数の上限に達しました。");
      guest = {
        id: crypto.randomUUID(),
        name: nickname,
        card: card(),
        secret: input.joinKey,
        bingoAt: null,
        rank: null,
      };
      state.guests.push(guest);
      state.revision++;
      localStorage.setItem(storage, JSON.stringify(state));
    }
    headers.set("x-player-key", guest.secret);
    return { playerKey: guest.secret, room: view(state, headers) };
  }
  if (suffix === "/action" && init.method === "POST") {
    if (!host) fail("幹事画面から開いてください。", 401);
    const input = JSON.parse(String(init.body));
    if (input.expectedGameNumber !== state.gameNumber)
      fail("別のゲームへ切り替わっています。");
    const prize = state.prizes.find((p) => p.id === input.prizeId);
    switch (input.action) {
      case "draw": {
        if (
          state.status === "finished" ||
          input.expectedDrawCount !== state.drawn.length
        )
          fail("最新の抽選結果を確認してください。");
        const remaining = Array.from({ length: 75 }, (_, i) => i + 1).filter(
          (n) => !state.drawn.includes(n),
        );
        if (!remaining.length) fail("すべての番号を抽選しました。");
        state.drawn.push(
          remaining[
            crypto.getRandomValues(new Uint32Array(1))[0] % remaining.length
          ],
        );
        state.status = "playing";
        for (const guest of state.guests)
          if (
            guest.bingoAt === null &&
            cardStatus(guest.card, state.drawn).bingo
          )
            guest.bingoAt = state.drawn.length;
        rank(state);
        break;
      }
      case "reset":
        state.gameNumber++;
        state.status = "lobby";
        state.drawn = [];
        state.prizes.forEach((p) => (p.playerId = null));
        state.guests.forEach((g) => {
          g.bingoAt = null;
          g.rank = null;
        });
        break;
      case "finish":
        state.status = "finished";
        break;
      case "prize":
        if (!prize) {
          if (state.prizes.length >= 30) fail("景品は30個までです。");
          state.prizes.push({
            id: input.prizeId,
            name: name(input.name, 40),
            playerId: null,
          });
        }
        break;
      case "award":
        if (
          !prize ||
          prize.playerId ||
          !state.guests.some(
            (g) => g.id === input.playerId && g.bingoAt !== null,
          ) ||
          state.prizes.some((p) => p.playerId === input.playerId)
        )
          fail("景品または当選者を確認してください。");
        prize.playerId = input.playerId;
        break;
      case "unaward":
        if (!prize) fail("景品が見つかりません。");
        prize.playerId = null;
        break;
      case "remove_prize":
        if (!prize || prize.playerId)
          fail("先に割り当てを取り消してください。");
        state.prizes = state.prizes.filter((p) => p.id !== input.prizeId);
        break;
      default:
        fail("この操作は体験デモでは利用できません。", 400);
    }
    state.revision++;
    localStorage.setItem(storage, JSON.stringify(state));
    return { room: view(state, headers) };
  }
  if (suffix) fail("体験デモの操作を確認してください。", 404);
  if (parsed.searchParams.get("revision") === String(state.revision))
    return null;
  return view(state, headers);
}
export async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  // shortcut: demo state is browser-local; actual events use the server APIs and durable DB.
  return dispatch(url, init) as T;
}
export async function apiBlob(url: string, init: RequestInit = {}) {
  const rows = await api<{ name: string }[]>(url, init);
  const cell = (text: string) =>
    `"${(/^[=+\-@]/.test(text) ? "'" : "") + text.replaceAll('"', '""')}"`;
  return new Blob(
    ["\ufeff名前\r\n" + rows.map((row) => cell(row.name)).join("\r\n")],
    { type: "text/csv;charset=utf-8" },
  );
}
