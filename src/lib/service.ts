import {
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { Row, Transaction } from "@libsql/client";
import { db } from "./db";
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
} from "./game";

export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const token = () => randomBytes(32).toString("base64url");
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
  };
}
async function readRoom(
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
function checkHost(row: Row, secret: string | null) {
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
async function write<T>(fn: (tx: Transaction) => Promise<T>) {
  for (let attempt = 0; ; attempt++) {
    let tx: Transaction | undefined;
    try {
      tx = await (await db()).transaction("write");
      const result = await fn(tx);
      await tx.commit();
      return result;
    } catch (error) {
      if (tx) {
        try {
          await tx.rollback();
        } catch {
          /* Preserve the original error. */
        }
      }
      const code =
        error && typeof error === "object" && "code" in error ? error.code : "";
      if (
        attempt >= 4 ||
        (code !== "SQLITE_BUSY" && code !== "TRANSACTION_ACTIVE")
      )
        throw error;
      await delay(20 * (attempt + 1) + randomInt(30));
    } finally {
      tx?.close();
    }
  }
}

export async function createRoom(title: unknown, ip: string) {
  const name = cleanName(title, 40);
  const secret = token();
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const id = Array.from(
    randomBytes(8),
    (n) => alphabet[n % alphabet.length],
  ).join("");
  await write(async (tx) => {
    const now = Date.now();
    await tx.execute({
      sql: "DELETE FROM rate_limits WHERE expires_at < ?",
      args: [now],
    });
    await tx.execute({
      sql: "DELETE FROM players WHERE room_id IN (SELECT id FROM rooms WHERE expires_at < ?)",
      args: [now - 30 * 86400000],
    });
    await tx.execute({
      sql: "DELETE FROM rooms WHERE expires_at < ?",
      args: [now - 30 * 86400000],
    });
    const key = hash(`${ip}:${Math.floor(now / 3600000)}`);
    const count = await tx.execute({
      sql: "SELECT count FROM rate_limits WHERE key = ?",
      args: [key],
    });
    if (Number(count.rows[0]?.count || 0) >= 10)
      throw new AppError(
        "イベントを作成しすぎています。時間をおいてお試しください。",
        429,
      );
    await tx.execute({
      sql: "INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1",
      args: [key, now + 3600000],
    });
    await tx.execute({
      sql: "INSERT INTO rooms(id,host_hash,title,created_at,expires_at) VALUES(?,?,?,?,?)",
      args: [id, hash(secret), name, now, now + 7 * 86400000],
    });
  });
  return { id, hostToken: secret };
}

export async function joinRoom(
  id: string,
  name: unknown,
  existing: string | undefined,
) {
  const nickname = cleanName(name);
  const secret = token();
  return write(async (tx) => {
    const row = await readRoom(tx, id);
    if (existing) {
      const old = await tx.execute({
        sql: "SELECT id FROM players WHERE room_id=? AND auth_hash=?",
        args: [id, hash(existing)],
      });
      if (old.rows.length) return { secret: existing };
    }
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
}

export async function getView(
  id: string,
  hostSecret: string | null,
  playerSecret?: string,
  revision?: number,
): Promise<RoomView | null> {
  validRoomId(id);
  const store = await db();
  const playerHash = playerSecret ? hash(playerSecret) : "";
  // One statement keeps the room and cards in the same snapshot, without a transaction per poll.
  const result = await store.execute({
    sql: `
    SELECT rooms.*,
      CASE WHEN revision=? THEN NULL ELSE
        (SELECT COUNT(*) FROM players WHERE room_id=rooms.id) END AS player_count,
      CASE WHEN revision=? THEN NULL ELSE (
        SELECT json_group_array(json_object('id',id,'name',name,'bingo_at',bingo_at,'card',card))
        FROM (SELECT id,name,bingo_at,CASE WHEN auth_hash=? THEN card ELSE NULL END AS card
          FROM players WHERE room_id=rooms.id AND (bingo_at IS NOT NULL OR auth_hash=? OR ?=1)
          ORDER BY bingo_at IS NULL,bingo_at,joined_at,id)
      ) END AS members
    FROM rooms WHERE id=?`,
    args: [
      revision ?? null,
      revision ?? null,
      playerHash,
      playerHash,
      hostSecret ? 1 : 0,
      id,
    ],
  });
  const row = checkedRoom(result.rows[0]);
  if (hostSecret) checkHost(row, hostSecret);
  if (revision === Number(row.revision)) return null;
  const room = roomFrom(row);
  const rows = JSON.parse(String(row.members)) as {
    id: string;
    name: string;
    bingo_at: number | null;
    card: string | null;
  }[];
  let rank = 0,
    previousBingo: number | null = null;
  const players: Player[] = rows.map((p, index) => {
    const bingoAt = p.bingo_at === null ? null : Number(p.bingo_at);
    if (bingoAt !== null && bingoAt !== previousBingo) rank = index + 1;
    previousBingo = bingoAt;
    return {
      id: String(p.id),
      name: String(p.name),
      bingoAt,
      rank: bingoAt === null ? null : rank,
    };
  });
  const view: RoomView = {
    ...room,
    count: Number(row.player_count),
    limit: room.plan === "event" ? PAID_LIMIT : FREE_LIMIT,
    winners: players.filter((p) => p.bingoAt !== null),
  };
  if (hostSecret) view.players = players;
  if (playerSecret) {
    const index = rows.findIndex((p) => p.card !== null);
    if (index !== -1)
      view.me = {
        ...players[index],
        card: JSON.parse(String(rows[index].card)) as Card,
      };
  }
  return view;
}

export async function hostAction(
  id: string,
  secret: string | null,
  input: Record<string, unknown>,
) {
  await write(async (tx) => {
    const row = await readRoom(tx, id);
    checkHost(row, secret);
    const room = roomFrom(row);
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
        break;
      }
      case "finish":
        room.status = "finished";
        break;
      case "reset":
        room.status = "lobby";
        room.drawn = [];
        room.prizes = room.prizes.map((p) => ({ ...p, playerId: null }));
        await tx.execute({
          sql: "UPDATE players SET bingo_at=NULL WHERE room_id=?",
          args: [id],
        });
        break;
      case "prize": {
        if (room.prizes.length >= 30)
          throw new AppError("景品は30個まで登録できます。");
        room.prizes.push({
          id: randomUUID(),
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
        prize.playerId = String(input.playerId);
        break;
      }
      default:
        throw new AppError("操作を確認してください。");
    }
    await tx.execute({
      sql: "UPDATE rooms SET status=?,drawn=?,prizes=?,revision=revision+1 WHERE id=?",
      args: [
        room.status,
        JSON.stringify(room.drawn),
        JSON.stringify(room.prizes),
        id,
      ],
    });
  });
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

export async function upgradeRoom(roomId: string, sessionId: string) {
  await write(async (tx) => {
    validRoomId(roomId);
    const room = (
      await tx.execute({
        sql: "SELECT * FROM rooms WHERE id=?",
        args: [roomId],
      })
    ).rows[0];
    if (!room) throw new AppError("イベントが見つかりません。", 404);
    if (room.checkout_id !== sessionId)
      throw new AppError("決済とイベントの対応を確認できません。", 409);
    const existing = await tx.execute({
      sql: "SELECT session_id FROM payments WHERE session_id=?",
      args: [sessionId],
    });
    if (existing.rows.length) return;
    await tx.execute({
      sql: "INSERT INTO payments(session_id,room_id,paid_at) VALUES(?,?,?)",
      args: [sessionId, roomId, Date.now()],
    });
    await tx.execute({
      sql: "UPDATE rooms SET plan='event',expires_at=?,revision=revision+1 WHERE id=?",
      args: [
        Math.max(Number(room.expires_at), Date.now() + 30 * 86400000),
        roomId,
      ],
    });
  });
}
