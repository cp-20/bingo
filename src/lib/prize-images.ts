import sharp from "sharp";
import { db, writeTransaction } from "./db";
import { AppError } from "./errors";
import {
  authorizeHost,
  checkHost,
  hash,
  invalidateRoom,
  readRoom,
} from "./service";
import type { Prize } from "./game";
export async function putPrizeImage(
  id: string,
  secret: string | null,
  prizeId: string,
  data: Uint8Array,
) {
  await authorizeHost(id, secret); // Authorize before image decoding.
  if (!data.length || data.length > 512 * 1024)
    throw new AppError("写真は512KB以内に縮小してから送信してください。", 413);
  let jpeg: Buffer;
  try {
    const source = sharp(data, {
      limitInputPixels: 16_000_000,
      animated: false,
    });
    const info = await source.metadata();
    if (
      !["jpeg", "png", "webp"].includes(info.format || "") ||
      (info.pages || 1) > 1
    )
      throw new Error("format");
    jpeg = await source
      .rotate()
      .resize(960, 720, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 78, mozjpeg: true })
      .toBuffer();
  } catch {
    throw new AppError("JPEG・PNG・WebPの写真を選んでください。");
  }
  const imageKey = hash(jpeg.toString("base64"));
  await writeTransaction(async (tx) => {
    const row = await readRoom(tx, id);
    checkHost(row, secret);
    const prizes = JSON.parse(String(row.prizes)) as Prize[],
      prize = prizes.find((p) => p.id === prizeId);
    if (!prize || prize.playerId)
      throw new AppError("未割り当ての景品を選び直してください。", 409);
    const total = Number(
      (
        await tx.execute({
          sql: "SELECT COALESCE(SUM(length(data_base64)),0) AS n FROM prize_images WHERE room_id=?",
          args: [id],
        })
      ).rows[0].n,
    );
    if (total + (jpeg.length * 4) / 3 > 12 * 1024 * 1024)
      throw new AppError(
        "この会場の写真容量がいっぱいです。写真を小さくしてください。",
        413,
      );
    await tx.execute({
      sql: "INSERT OR IGNORE INTO prize_images VALUES(?,?,?,?)",
      args: [id, imageKey, jpeg.toString("base64"), Date.now()],
    });
    prize.imageKey = imageKey;
    await tx.execute({
      sql: "UPDATE rooms SET prizes=?,revision=revision+1 WHERE id=?",
      args: [JSON.stringify(prizes), id],
    });
  });
  invalidateRoom(id);
  return imageKey;
}
export async function prizeImage(id: string, imageKey: string) {
  if (!/^[a-f0-9]{64}$/.test(imageKey))
    throw new AppError("写真が見つかりません。", 404);
  const store = await db();
  await readRoom(store, id);
  const image = (
    await store.execute({
      sql: "SELECT data_base64 FROM prize_images WHERE room_id=? AND image_key=?",
      args: [id, imageKey],
    })
  ).rows[0];
  if (!image) throw new AppError("写真が見つかりません。", 404);
  return Buffer.from(String(image.data_base64), "base64");
}
