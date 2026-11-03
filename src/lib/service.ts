import {
  createHash,
  createHmac,
  randomInt,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { Row, Transaction } from "@libsql/client";
import { db, writeTransaction } from "./db";
import { AppError } from "./errors";
export { AppError } from "./errors";
import {
  cardStatus,
  cleanName,
  FREE_LIMIT,
  makeCard,
  nextNumber,
  PAID_LIMIT,
  type Card,
  type Player,
  type Prize,
  type Room,
  type RoomView,
  type Receipt,
} from "./game";

export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const token = () => randomBytes(32).toString("base64url");
export const crewSecret = (id: string, host: string) =>
  createHmac("sha256", host).update(`bingo-crew:${id}`).digest("base64url");
export function validRoomId(id: string) {
  if (!/^[A-Z2-9]{8}$/.test(id))
    throw new AppError("イベントが見つかりません。", 404);
  return id;
}
function roomFrom(row: Row): Room {
  return {
    id: String(row.id),
    title: String(row.title),
    status: row.status as Room["status"],
    plan: row.plan as Room["plan"],
    drawn: JSON.parse(String(row.drawn)),
    prizes: JSON.parse(String(row.prizes)),
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
    revision: Number(row.revision),
    gameNumber: Number(row.game_number),
    stage: JSON.parse(String(row.stage || "null")),
    featuredPrizeId: row.featured_prize_id
      ? String(row.featured_prize_id)
      : null,
  };
}
export async function readRoom(
  store: { execute: Transaction["execute"] },
  id: string,
) {
  validRoomId(id);
  const result = await store.execute({
    sql: "SELECT * FROM rooms WHERE id = ?",
    args: [id],
  });
  return checkedRoom(result.rows[0]);
}
function checkedRoom(row: Row | undefined) {
  if (!row) throw new AppError("イベントが見つかりません。", 404);
  if (Number(row.expires_at) < Date.now())
    throw new AppError("このイベントの利用期間は終了しました。", 410);
  return row;
}
export function checkHost(row: Row, secret: string | null) {
  if (
    !secret ||
    secret.length !== 43 ||
    !timingSafeEqual(
      Buffer.from(hash(secret)),
      Buffer.from(String(row.host_hash)),
    )
  )
    throw new AppError("幹事用リンクから開いてください。", 401);
}
export async function authorizeHost(id: string, secret: string | null) {
  const row = await readRoom(await db(), id);
  checkHost(row, secret);
  return row;
}
export function validSecret(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}
export async function createRoom(
  title: unknown,
  ip: string,
  creationKey?: string,
) {
  const name = cleanName(title, 40);
  if (creationKey !== undefined && !validSecret(creationKey))
    throw new AppError("作成情報を確認してください。");
  const secret = creationKey || token();
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = Array.from(
    randomBytes(8),
    (n) => alphabet[n % alphabet.length],
  ).join("");
  await writeTransaction(async (tx) => {
    const now = Date.now();
    const old = (
      await tx.execute({
        sql: "SELECT * FROM rooms WHERE host_hash=?",
        args: [hash(secret)],
      })
    ).rows[0];
    if (old) {
      checkedRoom(old);
      if (old.title !== name)
        throw new AppError(
          "作成内容が変わっています。新しく作成してください。",
          409,
        );
      id = String(old.id);
      return;
    }
    const key = hash(`${ip}:${Math.floor(now / 3600000)}`);
    const count = await tx.execute({
      sql: "SELECT count FROM rate_limits WHERE key = ?",
      args: [key],
    });
    if (Number(count.rows[0]?.count || 0) >= 10)
      throw new AppError(
        "イベントを作成しすぎています。時間をおいてお試しください。",
        429,
        "ROOM_RATE_LIMIT",
        Math.ceil((3600000 - (now % 3600000)) / 1000),
      );
    const globalKey = `room-budget:${Math.floor(now / 3600000)}`;
    const globalCount = Number(
      (
        await tx.execute({
          sql: "SELECT count FROM rate_limits WHERE key=?",
          args: [globalKey],
        })
      ).rows[0]?.count || 0,
    );
    if (globalCount >= 100)
      throw new AppError(
        "新しい会場の作成が混み合っています。開催中のイベントはそのまま続けられます。時間をおいてお試しください。",
        429,
        "ROOM_BUDGET_LIMIT",
        Math.ceil((3600000 - (now % 3600000)) / 1000),
      );
    await tx.execute({
      sql: "INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1",
      args: [globalKey, now + 3600000],
    });
    await tx.execute({
      sql: "INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1",
      args: [key, now + 3600000],
    });
    await tx.execute({
      sql: "INSERT INTO rooms(id,host_hash,title,created_at,expires_at,crew_hash) VALUES(?,?,?,?,?,?)",
      args: [
        id,
        hash(secret),
        name,
        now,
        now + 7 * 86400000,
        hash(crewSecret(id, secret)),
      ],
    });
    await tx.execute({
      sql: "INSERT INTO room_live(room_id) VALUES(?)",
      args: [id],
    });
  });
  invalidateRoom(id);
  return { id, hostToken: secret };
}

export async function joinRoom(
  id: string,
  name: unknown,
  existing: string | undefined,
  joinKey?: string,
) {
  if (joinKey !== undefined && !validSecret(joinKey))
    throw new AppError("参加情報を確認してください。");
  const secret = joinKey || token();
  const result = await writeTransaction(async (tx) => {
    const row = await readRoom(tx, id);
    for (const candidate of [joinKey, existing])
      if (candidate && validSecret(candidate)) {
        const old = await tx.execute({
          sql: "SELECT id FROM players WHERE room_id=? AND auth_hash=?",
          args: [id, hash(candidate)],
        });
        if (old.rows.length) return { secret: candidate };
      }
    const nickname = cleanName(name);
    if (row.status !== "lobby")
      throw new AppError("受付は終了しました。幹事にお声がけください。", 409);
    const count = await tx.execute({
      sql: "SELECT COUNT(*) AS n FROM players WHERE room_id=?",
      args: [id],
    });
    const limit = row.plan === "event" ? PAID_LIMIT : FREE_LIMIT;
    if (Number(count.rows[0].n) >= limit)
      throw new AppError(
        "参加人数の上限に達しました。幹事にお声がけください。",
        409,
      );
    const duplicate = await tx.execute({
      sql: "SELECT id FROM players WHERE room_id=? AND name_key=?",
      args: [id, nickname.toLocaleLowerCase("ja")],
    });
    if (duplicate.rows.length)
      throw new AppError(
        "同じ名前で参加している人がいます。別の名前をお使いください。",
        409,
      );
    await tx.execute({
      sql: "INSERT INTO players(id,room_id,auth_hash,name,name_key,card,joined_at) VALUES(?,?,?,?,?,?,?)",
      args: [
        randomUUID(),
        id,
        hash(secret),
        nickname,
        nickname.toLocaleLowerCase("ja"),
        JSON.stringify(makeCard()),
        Date.now(),
      ],
    });
    await tx.execute({
      sql: "UPDATE rooms SET revision=revision+1 WHERE id=?",
      args: [id],
    });
    return { secret };
  });
  invalidateRoom(id);
  return result;
}

// The cache contains private server data. Only getView's explicit projection may leave the server.
type Member = {
  id: string;
  name: string;
  auth_hash: string;
  bingo_at: number | null;
  card: string;
};
type Snapshot = {
  row: Row;
  room: Room;
  members: Member[];
  players: Player[];
  winners: Player[];
  reachCount: number;
  receipts: Receipt[];
  byAuth: Map<string, number>;
};
type CachedRoom = {
  snapshot?: Snapshot;
  freshUntil: number;
  pending?: Promise<Snapshot>;
};
const roomCache = new Map<string, CachedRoom>();

export function invalidateRoom(id: string) {
  roomCache.delete(id);
}
async function roomSnapshot(
  store: Awaited<ReturnType<typeof db>>,
  id: string,
  knownRevision?: number,
): Promise<Snapshot> {
  let entry = roomCache.get(id);
  if (!entry) {
    entry = { freshUntil: 0 };
    roomCache.set(id, entry);
    if (roomCache.size > 200) roomCache.delete(roomCache.keys().next().value!);
  } else {
    roomCache.delete(id);
    roomCache.set(id, entry);
  }
  if (
    entry.snapshot &&
    entry.freshUntil > Date.now() &&
    entry.snapshot.room.expiresAt > Date.now() &&
    (knownRevision === undefined ||
      entry.snapshot.room.revision >= knownRevision)
  )
    return entry.snapshot;
  if (entry.pending) return entry.pending;
  const current = entry,
    previous = entry.snapshot,
    started = Date.now();
  current.pending = (async () => {
    // A single SQL statement keeps numbers, ranking and membership in one consistent snapshot.
    const result = await store.execute({
      sql: `SELECT rooms.*, CASE WHEN revision=? THEN NULL ELSE (
        SELECT json_group_array(json_object('id',id,'name',name,'auth_hash',auth_hash,'bingo_at',bingo_at,'card',card))
        FROM (SELECT id,name,auth_hash,bingo_at,card FROM players WHERE room_id=rooms.id
          ORDER BY bingo_at IS NULL,bingo_at,joined_at,id)
       ) END AS members, CASE WHEN revision=? THEN NULL ELSE (
        SELECT json_group_array(json_object('id',id,'prizeId',prize_id,'prizeName',prize_name,'imageKey',image_key,'playerId',player_id,'playerName',player_name,'gameNumber',game_number,'claimCode',claim_code,'deliveredAt',delivered_at)) FROM awards WHERE room_id=rooms.id AND cancelled_at IS NULL
      ) END AS receipts FROM rooms WHERE id=?`,
      args: [
        previous?.room.revision ?? null,
        previous?.room.revision ?? null,
        id,
      ],
    });
    const row = checkedRoom(result.rows[0]),
      room = roomFrom(row);
    let snapshot: Snapshot;
    if (previous && row.members === null) snapshot = { ...previous, row, room };
    else {
      const members = JSON.parse(String(row.members)) as Member[];
      let rank = 0,
        previousBingo: number | null = null;
      const players: Player[] = members.map((member, index) => {
        const bingoAt =
          member.bingo_at === null ? null : Number(member.bingo_at);
        if (bingoAt !== null && bingoAt !== previousBingo) rank = index + 1;
        previousBingo = bingoAt;
        return {
          id: member.id,
          name: member.name,
          bingoAt,
          rank: bingoAt === null ? null : rank,
        };
      });
      snapshot = {
        row,
        room,
        members,
        players,
        reachCount: members.filter(
          (member) =>
            member.bingo_at === null &&
            cardStatus(JSON.parse(member.card), room.drawn).reach,
        ).length,
        receipts: JSON.parse(String(row.receipts)),
        winners: players.filter((player) => player.bingoAt !== null),
        byAuth: new Map(
          members.map((member, index) => [member.auth_hash, index]),
        ),
      };
    }
    // A read started before a write must never repopulate an invalidated cache entry.
    if (roomCache.get(id) === current) {
      current.snapshot = snapshot;
      current.freshUntil = started + 500;
    }
    return snapshot;
  })();
  try {
    return await current.pending;
  } catch (error) {
    if (roomCache.get(id) === current) roomCache.delete(id);
    throw error;
  } finally {
    current.pending = undefined;
  }
}

export async function getView(
  id: string,
  hostSecret: string | null,
  playerSecret?: string,
  revision?: number,
  cardOnly = false,
): Promise<RoomView | null> {
  validRoomId(id);
  const store = await db();
  const { row, room, members, players, winners, byAuth, receipts, reachCount } =
    await roomSnapshot(store, id, revision);
  if (hostSecret) checkHost(row, hostSecret);
  if (revision === room.revision) return null;
  const view: RoomView = {
    ...room,
    drawn: [...room.drawn],
    prizes: room.prizes.map((prize) => ({ ...prize })),
    count: players.length,
    reachCount,
    limit: room.plan === "event" ? PAID_LIMIT : FREE_LIMIT,
    winners:
      cardOnly && !hostSecret ? [] : winners.map((player) => ({ ...player })),
  };
  if (hostSecret) {
    view.players = players.map((player) => ({ ...player }));
    view.pendingPrizes = receipts.filter(
      (receipt) => !receipt.deliveredAt,
    ).length;
    if (row.crew_hash) view.crewKey = crewSecret(id, hostSecret);
    view.paymentStatus =
      room.plan === "event"
        ? "paid"
        : String(
            (
              await store.execute({
                sql: "SELECT status FROM checkout_orders WHERE room_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1",
                args: [id],
              })
            ).rows[0]?.status || "none",
          );
  }
  if (playerSecret) {
    const index = byAuth.get(hash(playerSecret));
    if (index !== undefined) {
      view.me = {
        ...players[index],
        card: JSON.parse(members[index].card) as Card,
      };
      view.receipts = receipts
        .filter((receipt) => receipt.playerId === players[index].id)
        .map((receipt) => ({ ...receipt }));
    }
  }
  return view;
}

export async function hostAction(
  id: string,
  secret: string | null,
  input: Record<string, unknown>,
) {
  await writeTransaction(async (tx) => {
    const row = await readRoom(tx, id);
    checkHost(row, secret);
    const room = roomFrom(row);
    if (input.expectedGameNumber !== room.gameNumber)
      throw new AppError(
        "別のゲームに切り替わっています。最新の画面を確認してください。",
        409,
        "STALE_GAME",
      );
    switch (input.action) {
      case "draw": {
        if (room.status === "finished")
          throw new AppError("イベントは終了しています。", 409);
        if (input.expectedDrawCount !== room.drawn.length)
          throw new AppError(
            "画面を更新しました。もう一度お試しください。",
            409,
          );
        const players = await tx.execute({
          sql: "SELECT id,card FROM players WHERE room_id=? AND bingo_at IS NULL",
          args: [id],
        });
        const total = await tx.execute({
          sql: "SELECT COUNT(*) AS n FROM players WHERE room_id=?",
          args: [id],
        });
        if (!Number(total.rows[0].n))
          throw new AppError("参加者が入ってから抽選してください。");
        if (room.drawn.length === 75)
          throw new AppError("すべての番号を抽選しました。");
        room.drawn.push(nextNumber(room.drawn));
        const winners = players.rows
          .filter(
            (p) => cardStatus(JSON.parse(String(p.card)), room.drawn).bingo,
          )
          .map((p) => String(p.id));
        if (winners.length)
          await tx.execute({
            sql: `UPDATE players SET bingo_at=? WHERE room_id=? AND id IN (${winners.map(() => "?").join(",")})`,
            args: [room.drawn.length, id, ...winners],
          });
        room.status = "playing";
        room.stage = null;
        break;
      }
      case "finish":
        room.status = "finished";
        room.stage = null;
        break;
      case "reset":
        room.gameNumber++;
        room.status = "lobby";
        room.drawn = [];
        room.stage = null;
        room.featuredPrizeId = null;
        await tx.execute({
          sql: "UPDATE players SET bingo_at=NULL WHERE room_id=?",
          args: [id],
        });
        break;
      case "prize": {
        if (
          typeof input.prizeId !== "string" ||
          !/^[0-9a-f-]{36}$/i.test(input.prizeId)
        )
          throw new AppError("景品の登録情報を確認してください。");
        const previous = room.prizes.find((p) => p.id === input.prizeId);
        if (previous) {
          if (previous.name !== cleanName(input.name, 40))
            throw new AppError("景品の内容が変わっています。", 409);
          return;
        }
        if (room.prizes.length >= 30)
          throw new AppError("景品は30個まで登録できます。");
        room.prizes.push({
          id: input.prizeId,
          name: cleanName(input.name, 40),
          playerId: null,
        });
        break;
      }
      case "award": {
        const prize = room.prizes.find((p) => p.id === input.prizeId);
        const winner = await tx.execute({
          sql: "SELECT id FROM players WHERE room_id=? AND id=? AND bingo_at IS NOT NULL",
          args: [id, typeof input.playerId === "string" ? input.playerId : ""],
        });
        if (
          !prize ||
          prize.playerId ||
          !winner.rows.length ||
          room.prizes.some((p) => p.playerId === input.playerId)
        )
          throw new AppError("景品または当選者を確認してください。", 409);
        const player = (
          await tx.execute({
            sql: "SELECT name FROM players WHERE id=? AND room_id=?",
            args: [String(input.playerId), id],
          })
        ).rows[0];
        const awardId = randomUUID();
        await tx.execute({
          sql: "INSERT INTO awards(id,room_id,prize_id,player_id,player_name,prize_name,image_key,game_number,claim_code) VALUES(?,?,?,?,?,?,?,?,?)",
          args: [
            awardId,
            id,
            prize.id,
            String(input.playerId),
            String(player.name),
            prize.name,
            prize.imageKey || null,
            room.gameNumber,
            String(randomInt(100000, 1000000)),
          ],
        });
        prize.playerId = String(input.playerId);
        prize.awardId = awardId;
        prize.awardedName = String(player.name);
        prize.awardedGame = room.gameNumber;
        prize.deliveredAt = null;
        room.stage = { mode: "award", prizeId: prize.id };
        if (room.featuredPrizeId === prize.id) room.featuredPrizeId = null;
        break;
      }
      case "unaward": {
        const prize = room.prizes.find((p) => p.id === input.prizeId);
        if (!prize) throw new AppError("景品が見つかりません。", 404);
        if (input.expectedAwardId !== prize.awardId)
          throw new AppError(
            "当選者が変更されています。最新の景品を確認してください。",
            409,
          );
        if (prize.deliveredAt)
          throw new AppError(
            "受け渡し済みです。景品係が受け渡しを取り消してから変更してください。",
            409,
          );
        await tx.execute({
          sql: "UPDATE awards SET cancelled_at=? WHERE room_id=? AND id=? AND delivered_at IS NULL",
          args: [Date.now(), id, prize.awardId || ""],
        });
        prize.playerId = null;
        delete prize.awardId;
        delete prize.awardedName;
        delete prize.awardedGame;
        delete prize.deliveredAt;
        room.stage = null;
        break;
      }
      case "remove_prize": {
        const prize = room.prizes.find((p) => p.id === input.prizeId);
        if (!prize || prize.playerId)
          throw new AppError(
            "割り当て済みの景品は、先に当選者を変更してください。",
            409,
          );
        room.prizes = room.prizes.filter((p) => p.id !== input.prizeId);
        break;
      }
      case "stage": {
        if (input.mode === "draw") room.stage = null;
        else if (input.mode === "history") room.stage = { mode: "history" };
        else if (input.mode === "prize") {
          const prize = room.prizes.find(
            (p) => p.id === input.prizeId && !p.playerId,
          );
          if (!prize)
            throw new AppError("紹介する景品を選び直してください。", 409);
          room.stage = { mode: "prize", prizeId: prize.id };
          room.featuredPrizeId = prize.id;
        } else throw new AppError("表示を選んでください。");
        break;
      }
      case "crew":
        await tx.execute({
          sql: "UPDATE rooms SET crew_hash=? WHERE id=?",
          args: [hash(crewSecret(id, secret!)), id],
        });
        break;
      default:
        throw new AppError("操作を確認してください。");
    }
    await tx.execute({
      sql: "UPDATE rooms SET status=?,drawn=?,prizes=?,game_number=?,stage=?,featured_prize_id=?,revision=revision+1 WHERE id=?",
      args: [
        room.status,
        JSON.stringify(room.drawn),
        JSON.stringify(room.prizes),
        room.gameNumber,
        JSON.stringify(room.stage || null),
        room.featuredPrizeId || null,
        id,
      ],
    });
  });
  invalidateRoom(id);
}

export async function printableCards(id: string, secret: string | null) {
  await authorizeHost(id, secret);
  return (
    await (
      await db()
    ).execute({
      sql: "SELECT id,name,card FROM players WHERE room_id=? ORDER BY joined_at,id",
      args: [id],
    })
  ).rows.map((p) => ({
    id: String(p.id),
    name: String(p.name),
    card: JSON.parse(String(p.card)) as Card,
  }));
}

// Only identity metadata leaves this private snapshot helper; never return auth hashes/cards.
export async function liveAccess(
  id: string,
  hostSecret: string | null,
  playerSecret?: string,
) {
  validRoomId(id);
  const snapshot = await roomSnapshot(await db(), id);
  if (hostSecret) {
    checkHost(snapshot.row, hostSecret);
    return { host: true, id: "host", name: "司会", room: snapshot.room };
  }
  const index = playerSecret
    ? snapshot.byAuth.get(hash(playerSecret))
    : undefined;
  return {
    host: false,
    id: index === undefined ? null : snapshot.players[index].id,
    name: index === undefined ? null : snapshot.players[index].name,
    room: snapshot.room,
  };
}
