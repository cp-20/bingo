import type {
  Card,
  Player,
  Room,
  RoomView,
  CommunityFeed,
  Receipt,
} from "../src/lib/game";
import { cardStatus } from "../src/lib/card";
import { clientSecret, RequestError } from "../src/lib/client";
export {
  clientSecret,
  savedSecret,
  saveSecret,
  RequestError,
  notifyRoom,
} from "../src/lib/client";

export const DEMO_ID = "DEMO8888";
const storage = "bingo-room-demo-v1";
type Guest = Player & { card: Card; secret: string };
type State = Room & {
  hostKey: string;
  crewKey: string;
  guests: Guest[];
  live: CommunityFeed;
  receipts: Receipt[];
  images: Record<string, string>;
};

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
    crewKey: clientSecret(),
    receipts: [],
    images: {},
    stage: null,
    featuredPrizeId: null,
    live: {
      revision: 1,
      chatEnabled: true,
      messages: [
        {
          id: crypto.randomUUID(),
          name: "さくら",
          body: "お肉のギフト、狙ってます！",
          host: false,
          createdAt: now - 20000,
        },
        {
          id: crypto.randomUUID(),
          name: "田中さん",
          body: "みなさんよろしく！",
          host: false,
          createdAt: now - 10000,
        },
        {
          id: crypto.randomUUID(),
          name: "司会",
          body: "景品をチェックしながら、カードを開いてお待ちください。",
          host: true,
          createdAt: now,
        },
      ],
      pinned: null,
      reactions: { clap: 0, cheer: 0, wow: 0 },
    },
    status: "lobby",
    plan: "free",
    drawn: [],
    prizes: [
      {
        id: crypto.randomUUID(),
        name: "ワイヤレスヘッドホン",
        imageKey: "sample-headphones",
        playerId: null,
      },
      {
        id: crypto.randomUUID(),
        name: "コーヒーギフト",
        imageKey: "sample-coffee",
        playerId: null,
      },
      {
        id: crypto.randomUUID(),
        name: "お肉のごちそう便",
        imageKey: "sample-beef",
        playerId: null,
      },
    ],
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
      Array.isArray(value.drawn) &&
      value.live &&
      value.crewKey
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
  state.stage = null;
  state.receipts = [];
  state.prizes.forEach((prize) => {
    prize.playerId = null;
    delete prize.awardId;
    delete prize.awardedName;
    delete prize.deliveredAt;
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
  const {
    hostKey,
    guests,
    crewKey,
    live: _live,
    receipts,
    images: _images,
    ...room
  } = state;
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
    reachCount: guests.filter(
      (g) => g.bingoAt === null && cardStatus(g.card, room.drawn).reach,
    ).length,
    limit: room.plan === "event" ? 300 : 30,
    winners: players
      .filter((p) => p.bingoAt !== null)
      .sort((a, b) => a.bingoAt! - b.bingoAt!),
    ...(host
      ? {
          players,
          crewKey,
          pendingPrizes: receipts.filter((r) => !r.deliveredAt).length,
          paymentReady: false,
          paymentStatus: "none",
        }
      : {}),
    ...(own
      ? {
          receipts: receipts.filter((r) => r.playerId === own.id),
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
  if (suffix === "/sync")
    return { room: view(state, headers), live: feed(state, headers) };
  if (suffix === "/community" && init.method === "POST") {
    const person = state.guests.find(
      (g) => g.secret === headers.get("x-player-key"),
    );
    if (!host && !person) fail("参加してからご利用ください。", 401);
    const input = JSON.parse(String(init.body)),
      live = state.live;
    if (input.action === "message") {
      if (!host && !live.chatEnabled) fail("チャットは一時お休み中です。");
      const body = String(input.body).trim();
      if (!body || [...body].length > 140)
        fail("1〜140文字で入力してください。", 400);
      if (!live.messages.some((m) => m.id === input.messageId))
        live.messages.push({
          id: input.messageId,
          name: host ? "司会" : person!.name,
          body,
          host,
          createdAt: Date.now(),
        });
      live.messages = live.messages.slice(-60);
    } else if (input.action === "reaction") {
      if (
        input.gameNumber !== state.gameNumber ||
        input.drawCount !== state.drawn.length
      )
        fail("新しい番号に切り替わりました。");
      const reactionKey = `demo-react-${host ? "host" : person!.id}-${state.gameNumber}-${state.drawn.length}`;
      if (
        !localStorage.getItem(reactionKey) &&
        ["clap", "cheer", "wow"].includes(input.kind)
      ) {
        live.reactions[input.kind as keyof typeof live.reactions]++;
        localStorage.setItem(reactionKey, input.kind);
      }
    } else {
      if (!host) fail("幹事だけが変更できます。", 403);
      if (input.action === "pause") live.chatEnabled = !!input.enabled;
      else if (input.action === "pin")
        live.pinned =
          live.messages.find((m) => m.id === input.messageId) || null;
      else if (input.action === "hide") {
        live.messages = live.messages.filter((m) => m.id !== input.messageId);
        if (live.pinned?.id === input.messageId) live.pinned = null;
      }
    }
    live.revision++;
    save(state);
    return { live: feed(state, headers) };
  }
  if (suffix === "/crew") {
    if (headers.get("authorization") !== `Bearer ${state.crewKey}`)
      fail("景品係用リンクから開いてください。", 401);
    if (init.method === "POST") {
      const input = JSON.parse(String(init.body)),
        receipt = state.receipts.find((r) => r.id === input.awardId);
      if (!receipt || receipt.playerId !== input.playerId)
        fail("当選者が変更されています。");
      if (!input.undo && input.claimCode !== receipt.claimCode)
        fail("6桁の受け取り番号を確認してください。");
      if (input.expectedDeliveredAt !== receipt.deliveredAt)
        fail(
          "別の操作で受け渡し状況が変わりました。最新の一覧を確認してください。",
        );
      receipt.deliveredAt = input.undo
        ? null
        : receipt.deliveredAt || Date.now();
      const prize = state.prizes.find((p) => p.awardId === receipt.id);
      if (prize) prize.deliveredAt = receipt.deliveredAt;
      state.revision++;
      save(state);
    }
    return {
      title: state.title,
      items: state.receipts.map(({ claimCode: _private, ...item }) => item),
    };
  }
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
        state.stage = null;
        state.live.reactions = { clap: 0, cheer: 0, wow: 0 };
        state.live.revision++;
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
        state.stage = null;
        state.featuredPrizeId = null;
        state.live.reactions = { clap: 0, cheer: 0, wow: 0 };
        state.live.revision++;
        state.guests.forEach((g) => {
          g.bingoAt = null;
          g.rank = null;
        });
        break;
      case "finish":
        state.status = "finished";
        state.stage = null;
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
        const winner = state.guests.find((g) => g.id === input.playerId)!;
        prize.awardId = crypto.randomUUID();
        prize.awardedName = winner.name;
        prize.awardedGame = state.gameNumber;
        prize.deliveredAt = null;
        state.receipts.push({
          id: prize.awardId,
          prizeId: prize.id,
          prizeName: prize.name,
          imageKey: prize.imageKey,
          playerId: winner.id,
          playerName: winner.name,
          gameNumber: state.gameNumber,
          claimCode: String(
            100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000),
          ),
          deliveredAt: null,
        });
        state.stage = { mode: "award", prizeId: prize.id };
        if (state.featuredPrizeId === prize.id) state.featuredPrizeId = null;
        break;
      case "unaward":
        if (!prize) fail("景品が見つかりません。");
        if (input.expectedAwardId !== prize.awardId)
          fail("当選者が変更されています。");
        if (prize.deliveredAt)
          fail("受け渡し済みです。景品係が取り消してから変更してください。");
        state.receipts = state.receipts.filter((r) => r.id !== prize.awardId);
        prize.playerId = null;
        delete prize.awardId;
        delete prize.awardedName;
        delete prize.deliveredAt;
        state.stage = null;
        break;
      case "remove_prize":
        if (!prize || prize.playerId)
          fail("先に割り当てを取り消してください。");
        state.prizes = state.prizes.filter((p) => p.id !== input.prizeId);
        break;
      case "stage":
        if (input.mode === "draw") state.stage = null;
        else if (input.mode === "history") state.stage = { mode: "history" };
        else if (input.mode === "prize" && prize && !prize.playerId) {
          state.stage = { mode: "prize", prizeId: prize.id };
          state.featuredPrizeId = prize.id;
        } else fail("紹介する景品を選び直してください。");
        break;
      case "crew":
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
function save(state: State) {
  localStorage.setItem(storage, JSON.stringify(state));
}
function feed(state: State, headers: Headers): CommunityFeed {
  const host = headers.get("authorization") === `Bearer ${state.hostKey}`,
    player = state.guests.find((g) => g.secret === headers.get("x-player-key"));
  const myReaction =
    localStorage.getItem(
      `demo-react-${host ? "host" : player?.id}-${state.gameNumber}-${state.drawn.length}`,
    ) || undefined;
  return {
    ...state.live,
    messages: host || player ? state.live.messages : [],
    myReaction,
  };
}
export function imageSource(_roomId: string, key: string) {
  return read().images[key] || "";
}
export async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  const parsed = new URL(url, location.origin);
  if (parsed.pathname.endsWith("/prize-image") && init.method === "POST") {
    const state = read();
    if (
      new Headers(init.headers).get("authorization") !==
      `Bearer ${state.hostKey}`
    )
      fail("幹事用リンクから開いてください。", 401);
    const prize = state.prizes.find(
      (p) => p.id === parsed.searchParams.get("prizeId") && !p.playerId,
    );
    if (!prize) fail("未割り当ての景品を選び直してください。");
    if (!(init.body instanceof Blob) || init.body.size > 512 * 1024)
      fail("写真が大きすぎます。", 413);
    const data = new Uint8Array(await init.body.arrayBuffer()),
      digest = await crypto.subtle.digest("SHA-256", data),
      key = Array.from(new Uint8Array(digest))
        .map((n) => n.toString(16).padStart(2, "0"))
        .join("");
    let raw = "";
    for (const n of data) raw += String.fromCharCode(n);
    state.images[key] = `data:image/jpeg;base64,${btoa(raw)}`;
    prize.imageKey = key;
    state.revision++;
    save(state);
    return { imageKey: key, room: view(state, new Headers(init.headers)) } as T;
  }
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
