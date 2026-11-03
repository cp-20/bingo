import { randomUUID } from "node:crypto";
import { db, writeTransaction } from "./db";
import { AppError } from "./errors";
import { checkHost, hash, liveAccess, readRoom } from "./service";
import type { ChatMessage, CommunityFeed } from "./game";

type FeedData = {
  revision: number;
  enabled: boolean;
  pinned: string | null;
  messages: (ChatMessage & { hidden: boolean })[];
  reactions: Record<string, string>;
};
const cache = new Map<string, { until: number; pending: Promise<FeedData> }>();
function clear(id: string) {
  cache.delete(id);
}
async function feedData(id: string, game: number, draw: number) {
  const key = `${id}:${game}:${draw}`;
  const old = cache.get(key);
  if (old && old.until > Date.now()) return old.pending;
  const pending: Promise<FeedData> = (async () => {
    const store = await db();
    const result = await store.execute({
      sql: `SELECT *,
      (SELECT json_group_array(json_object('id',id,'name',name,'body',body,'host',is_host,'createdAt',created_at,'hidden',hidden)) FROM (SELECT * FROM messages WHERE room_id=? AND hidden=0 AND (id=room_live.pinned_id OR id IN (SELECT id FROM messages WHERE room_id=room_live.room_id AND hidden=0 ORDER BY created_at DESC,rowid DESC LIMIT 60)) ORDER BY created_at DESC,rowid DESC)) AS messages,
      (SELECT json_group_object(player_id,kind) FROM reactions WHERE room_id=? AND game_number=? AND draw_count=?) AS reactions
      FROM room_live WHERE room_id=?`,
      args: [id, id, game, draw, id],
    });
    const row = result.rows[0];
    return {
      revision: Number(row?.revision || 1),
      enabled: row?.chat_enabled !== 0,
      pinned: row?.pinned_id ? String(row.pinned_id) : null,
      messages: JSON.parse(String(row?.messages || "[]"))
        .map((m: ChatMessage & { hidden: number }) => ({
          ...m,
          host: Boolean(m.host),
          hidden: Boolean(m.hidden),
        }))
        .reverse(),
      reactions: JSON.parse(String(row?.reactions || "{}")) as Record<
        string,
        string
      >,
    };
  })();
  cache.set(key, { until: Date.now() + 500, pending });
  if (cache.size > 400) cache.delete(cache.keys().next().value!);
  try {
    return await pending;
  } catch (error) {
    cache.delete(key);
    throw error;
  }
}
export async function getCommunity(
  id: string,
  host: string | null,
  player?: string,
  revision?: number,
): Promise<CommunityFeed | null> {
  const access = await liveAccess(id, host, player);
  const data = await feedData(
    id,
    access.room.gameNumber,
    access.room.drawn.length,
  );
  // A draw starts a fresh reaction tally even without a new chat message.
  const version =
    data.revision * 10000 +
    access.room.gameNumber * 100 +
    access.room.drawn.length;
  if (revision === version) return null;
  const visible = data.messages.filter((m) => !m.hidden);
  const reactions = { clap: 0, cheer: 0, wow: 0 };
  for (const kind of Object.values(data.reactions))
    if (kind in reactions) reactions[kind as keyof typeof reactions]++;
  return {
    revision: version,
    chatEnabled: data.enabled,
    messages: access.id
      ? visible.map(({ hidden: _hidden, ...message }) => message)
      : [],
    pinned: visible.find((m) => m.id === data.pinned) || null,
    reactions,
    ...(access.id && data.reactions[access.id]
      ? { myReaction: data.reactions[access.id] }
      : {}),
  };
}
export async function communityAction(
  id: string,
  host: string | null,
  player: string | undefined,
  input: Record<string, unknown>,
) {
  const result = await writeTransaction(async (tx) => {
    const row = await readRoom(tx, id);
    if (host) checkHost(row, host);
    const person = host
      ? { id: "host", name: "司会" }
      : (
          await tx.execute({
            sql: "SELECT id,name FROM players WHERE room_id=? AND auth_hash=?",
            args: [id, player ? hash(player) : ""],
          })
        ).rows[0];
    if (!person) throw new AppError("参加してからご利用ください。", 401);
    await tx.execute({
      sql: "INSERT OR IGNORE INTO room_live(room_id) VALUES(?)",
      args: [id],
    });
    const live = (
      await tx.execute({
        sql: "SELECT * FROM room_live WHERE room_id=?",
        args: [id],
      })
    ).rows[0];
    const kind = input.action;
    if (kind === "message") {
      if (!host && !Number(live.chat_enabled))
        throw new AppError("チャットは一時お休み中です。", 409);
      if (
        typeof input.messageId !== "string" ||
        !/^[0-9a-f-]{36}$/i.test(input.messageId)
      )
        throw new AppError("送信内容を確認してください。");
      if (typeof input.body !== "string")
        throw new AppError("メッセージを入力してください。");
      const text = input.body
        .normalize("NFC")
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .trim();
      if (!text || [...text].length > 140)
        throw new AppError("メッセージは1〜140文字で入力してください。");
      const previous = (
        await tx.execute({
          sql: "SELECT sender_id,body FROM messages WHERE id=?",
          args: [input.messageId],
        })
      ).rows[0];
      if (previous) {
        if (previous.sender_id !== person.id || previous.body !== text)
          throw new AppError("送信内容が変わっています。", 409);
        return;
      }
      const now = Date.now();
      const count = (
        await tx.execute({
          sql: "SELECT COUNT(*) AS n FROM messages WHERE room_id=? AND sender_id=? AND created_at>?",
          args: [id, person.id, now - 10000],
        })
      ).rows[0];
      if (Number(count.n) >= 3)
        throw new AppError(
          "少し間をあけて送信してください。",
          429,
          "CHAT_RATE",
          10,
        );
      const budget = (
        await tx.execute({
          sql: "SELECT COUNT(*) AS n FROM messages WHERE room_id=? AND created_at>?",
          args: [id, now - 1000],
        })
      ).rows[0];
      if (Number(budget.n) >= 20)
        throw new AppError(
          "たくさんの声が届いています。少し待って送信してください。",
          429,
          "CHAT_BUSY",
          2,
        );
      await tx.execute({
        sql: "INSERT INTO messages(id,room_id,sender_id,name,body,is_host,created_at) VALUES(?,?,?,?,?,?,?)",
        args: [
          input.messageId,
          id,
          String(person.id),
          String(person.name),
          text,
          host ? 1 : 0,
          now,
        ],
      });
      // Bound storage and reads, retaining a pinned announcement.
      await tx.execute({
        sql: "DELETE FROM messages WHERE room_id=? AND id!=COALESCE(?, '') AND id NOT IN (SELECT id FROM messages WHERE room_id=? ORDER BY created_at DESC,rowid DESC LIMIT 200)",
        args: [id, live.pinned_id, id],
      });
    } else if (kind === "reaction") {
      if (!["clap", "cheer", "wow"].includes(String(input.kind)))
        throw new AppError("リアクションを確認してください。");
      if (
        input.gameNumber !== Number(row.game_number) ||
        input.drawCount !== JSON.parse(String(row.drawn)).length
      )
        throw new AppError(
          "新しい番号に切り替わりました。もう一度お試しください。",
          409,
        );
      const old = (
        await tx.execute({
          sql: "SELECT kind FROM reactions WHERE room_id=? AND game_number=? AND draw_count=? AND player_id=?",
          args: [
            id,
            Number(row.game_number),
            Number(input.drawCount),
            String(person.id),
          ],
        })
      ).rows[0];
      if (old) return; // One cheer per person per draw. A retry cannot inflate counts.
      await tx.execute({
        sql: "INSERT INTO reactions VALUES(?,?,?,?,?)",
        args: [
          id,
          Number(row.game_number),
          Number(input.drawCount),
          String(person.id),
          String(input.kind),
        ],
      });
    } else {
      if (!host) throw new AppError("幹事だけが変更できます。", 403);
      if (kind === "pause")
        await tx.execute({
          sql: "UPDATE room_live SET chat_enabled=? WHERE room_id=?",
          args: [input.enabled === true ? 1 : 0, id],
        });
      else if (kind === "pin" || kind === "hide") {
        if (input.messageId !== null) {
          const message = (
            await tx.execute({
              sql: "SELECT id FROM messages WHERE room_id=? AND id=? AND hidden=0",
              args: [
                id,
                typeof input.messageId === "string" ? input.messageId : "",
              ],
            })
          ).rows[0];
          if (!message)
            throw new AppError("このメッセージは表示できません。", 409);
        }
        if (kind === "pin")
          await tx.execute({
            sql: "UPDATE room_live SET pinned_id=? WHERE room_id=?",
            args: [
              typeof input.messageId === "string" ? input.messageId : null,
              id,
            ],
          });
        else {
          await tx.execute({
            sql: "UPDATE messages SET hidden=1 WHERE room_id=? AND id=?",
            args: [id, String(input.messageId)],
          });
          await tx.execute({
            sql: "UPDATE room_live SET pinned_id=NULL WHERE room_id=? AND pinned_id=?",
            args: [id, String(input.messageId)],
          });
        }
      } else throw new AppError("操作を確認してください。");
    }
    await tx.execute({
      sql: "UPDATE room_live SET revision=revision+1 WHERE room_id=?",
      args: [id],
    });
  });
  // There may be cached entries for several recent draws of this room.
  for (const key of cache.keys()) if (key.startsWith(`${id}:`)) clear(key);
  return result;
}
