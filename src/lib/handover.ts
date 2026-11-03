import { timingSafeEqual } from "node:crypto";
import { db, writeTransaction } from "./db";
import { AppError } from "./errors";
import { hash, invalidateRoom, readRoom } from "./service";
import type { Row } from "@libsql/client";
export type Handover = {
  id: string;
  prizeName: string;
  imageKey?: string;
  playerId: string;
  playerName: string;
  gameNumber: number;
  deliveredAt: number | null;
};
function check(row: Row, secret: string | null) {
  if (
    !secret ||
    !row.crew_hash ||
    !timingSafeEqual(
      Buffer.from(hash(secret)),
      Buffer.from(String(row.crew_hash)),
    )
  )
    throw new AppError("景品係用リンクから開いてください。", 401);
}
export async function handoverQueue(id: string, secret: string | null) {
  const store = await db(),
    room = await readRoom(store, id);
  check(room, secret);
  const rows = (
    await store.execute({
      sql: "SELECT * FROM awards WHERE room_id=? AND cancelled_at IS NULL ORDER BY delivered_at IS NOT NULL,game_number,rowid",
      args: [id],
    })
  ).rows;
  return {
    title: String(room.title),
    items: rows.map((row) => ({
      id: String(row.id),
      prizeName: String(row.prize_name),
      imageKey: row.image_key ? String(row.image_key) : undefined,
      playerId: String(row.player_id),
      playerName: String(row.player_name),
      gameNumber: Number(row.game_number),
      deliveredAt: row.delivered_at === null ? null : Number(row.delivered_at),
    })) as Handover[],
  };
}
export async function confirmHandover(
  id: string,
  secret: string | null,
  input: Record<string, unknown>,
) {
  await writeTransaction(async (tx) => {
    const room = await readRoom(tx, id);
    check(room, secret);
    const award = (
      await tx.execute({
        sql: "SELECT * FROM awards WHERE room_id=? AND id=? AND cancelled_at IS NULL",
        args: [id, typeof input.awardId === "string" ? input.awardId : ""],
      })
    ).rows[0];
    if (!award || award.player_id !== input.playerId)
      throw new AppError(
        "当選者が変更されています。最新の一覧を確認してください。",
        409,
      );
    const currentDelivered =
      award.delivered_at === null ? null : Number(award.delivered_at);
    if (input.expectedDeliveredAt !== currentDelivered)
      throw new AppError(
        "別の操作で受け渡し状況が変わりました。最新の一覧を確認してください。",
        409,
      );
    if (
      input.undo !== true &&
      (typeof input.claimCode !== "string" ||
        !/^\d{6}$/.test(input.claimCode) ||
        !timingSafeEqual(
          Buffer.from(input.claimCode),
          Buffer.from(String(award.claim_code)),
        ))
    )
      throw new AppError(
        "参加者の画面にある6桁の受け取り番号を確認してください。",
        409,
      );
    const time =
      input.undo === true
        ? null
        : award.delivered_at === null
          ? Date.now()
          : Number(award.delivered_at);
    await tx.execute({
      sql: "UPDATE awards SET delivered_at=? WHERE id=?",
      args: [time, String(award.id)],
    });
    const prizes = JSON.parse(String(room.prizes)).map(
      (p: { awardId?: string }) =>
        p.awardId === award.id ? { ...p, deliveredAt: time } : p,
    );
    await tx.execute({
      sql: "UPDATE rooms SET prizes=?,revision=revision+1 WHERE id=?",
      args: [JSON.stringify(prizes), id],
    });
  });
  invalidateRoom(id);
}
