"use client";
import { useEffect, useRef, useState } from "react";
import { api, notifyRoom } from "@/lib/client";
import type { CommunityFeed, RoomView } from "@/lib/game";
import { cardStatus } from "@/lib/card";
import { DrawBall } from "./ui";
const choices = [
  { kind: "clap", icon: "👏", label: "おめでとう" },
  { kind: "cheer", icon: "🙌", label: "いけー！" },
  { kind: "wow", icon: "✨", label: "ほしい！" },
] as const;
export function Reactions({
  view,
  live,
  send,
  disabled,
}: {
  view: RoomView;
  live?: CommunityFeed;
  send: (input: Record<string, unknown>) => Promise<boolean>;
  disabled: boolean;
}) {
  return (
    <div className="reaction-buttons" aria-label="会場へリアクション">
      {choices.map((c) => (
        <button
          key={c.kind}
          disabled={disabled || !!live?.myReaction}
          aria-pressed={live?.myReaction === c.kind}
          onClick={() =>
            void send({
              action: "reaction",
              kind: c.kind,
              gameNumber: view.gameNumber,
              drawCount: view.drawn.length,
            })
          }
        >
          <span aria-hidden="true">{c.icon}</span>
          <span>{c.label}</span>
          <b>{live?.reactions[c.kind] || ""}</b>
        </button>
      ))}
    </div>
  );
}
export function useCommunity(
  view: RoomView,
  hostKey: string | null,
  playerKey: string | null,
  onLive: (live: CommunityFeed) => void,
) {
  const [error, setError] = useState("");
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  async function send(input: Record<string, unknown>) {
    if (sending.current) return false;
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ live: CommunityFeed }>(
        `/api/rooms/${view.id}/community`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(hostKey
              ? { Authorization: `Bearer ${hostKey}` }
              : { "X-Player-Key": playerKey || "" }),
          },
          body: JSON.stringify(input),
        },
      );
      onLive(result.live);
      notifyRoom(view.id);
      return true;
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "送信できませんでした。",
      );
      return false;
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  return { send, error, busy };
}
export function Community({
  view,
  live,
  host = false,
  connected,
  send,
  error,
  busy,
}: {
  view: RoomView;
  live?: CommunityFeed;
  host?: boolean;
  connected: boolean;
  send: (input: Record<string, unknown>) => Promise<boolean>;
  error: string;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false),
    [text, setText] = useState("");
  const draft = useRef<{ id: string; body: string } | undefined>(undefined);
  const composing = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null),
    list = useRef<HTMLDivElement>(null),
    follow = useRef(true);
  useEffect(() => {
    if (!host && open) {
      const before = document.activeElement as HTMLElement;
      dialog.current?.showModal();
      return () => {
        dialog.current?.close();
        before?.focus();
      };
    }
  }, [open, host]);
  useEffect(() => {
    if (follow.current && list.current)
      list.current.scrollTop = list.current.scrollHeight;
  }, [live?.revision, open]);
  const content = (
    <>
      <div className="chat-heading">
        <div>
          <h2>みんなの声</h2>
          <p>
            {host
              ? "選んだ投稿だけ会場スクリーンに映ります"
              : "会場のみんなとひとこと。名前も表示されます。"}
          </p>
        </div>
        {!host && (
          <button
            type="button"
            className="chat-close"
            aria-label="チャットを閉じる"
            onClick={() => setOpen(false)}
          >
            ×
          </button>
        )}
      </div>
      {!host && (
        <div className="chat-current">
          <span>いま出た番号</span>
          <DrawBall number={view.drawn.at(-1)} />
          <span>{view.me?.name}さん</span>
        </div>
      )}
      {!host && view.me && (
        <div
          className={`chat-game-state ${cardStatus(view.me.card, view.drawn).bingo ? "is-bingo" : ""}`}
          role="status"
        >
          {cardStatus(view.me.card, view.drawn).bingo ? (
            <>
              <b>ビンゴ！ {view.me.rank}位 おめでとう！</b>
              <button onClick={() => setOpen(false)}>
                カードと景品の案内を見る →
              </button>
            </>
          ) : cardStatus(view.me.card, view.drawn).reach ? (
            <>
              <b>リーチ！</b>
              <span>
                {cardStatus(view.me.card, view.drawn).needed.join("・")}
                番でビンゴ
              </span>
            </>
          ) : null}
          {view.receipts?.some((r) => !r.deliveredAt) && (
            <button onClick={() => setOpen(false)}>
              景品が決まりました！ 受け取り番号を見る →
            </button>
          )}
        </div>
      )}
      {host && (
        <div className="chat-management">
          <button
            disabled={!connected || busy}
            onClick={() =>
              void send({ action: "pause", enabled: !live?.chatEnabled })
            }
          >
            {live?.chatEnabled ? "投稿を一時休止" : "投稿を再開"}
          </button>
          {live?.pinned && (
            <button
              disabled={!connected || busy}
              onClick={() => void send({ action: "pin", messageId: null })}
            >
              投影を外す
            </button>
          )}
        </div>
      )}
      <div
        className="chat-messages"
        ref={list}
        onScroll={(e) => {
          const n = e.currentTarget;
          follow.current = n.scrollHeight - n.scrollTop - n.clientHeight < 50;
        }}
        role="log"
        aria-label="会場のチャット"
        aria-live="off"
      >
        {live?.messages.length ? (
          live.messages.map((message) => (
            <article className={message.host ? "from-mc" : ""} key={message.id}>
              <header>
                <b>
                  {message.name}
                  {message.host ? "（司会）" : ""}
                </b>
                <time>
                  {new Date(message.createdAt).toLocaleTimeString("ja-JP", {
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "Asia/Tokyo",
                  })}
                </time>
              </header>
              <p>{message.body}</p>
              {host && (
                <div className="chat-post-actions">
                  <button
                    aria-pressed={live.pinned?.id === message.id}
                    disabled={busy || !connected}
                    onClick={() =>
                      void send({
                        action: "pin",
                        messageId:
                          live.pinned?.id === message.id ? null : message.id,
                      })
                    }
                  >
                    {live.pinned?.id === message.id
                      ? "投影中・外す"
                      : "スクリーンに映す"}
                  </button>
                  <button
                    disabled={busy || !connected}
                    onClick={() =>
                      void send({ action: "hide", messageId: message.id })
                    }
                  >
                    非表示
                  </button>
                </div>
              )}
            </article>
          ))
        ) : (
          <p className="chat-empty">
            最初のひとことをどうぞ。
            <br />
            「あの景品、狙ってます！」
          </p>
        )}
      </div>
      {!live?.chatEnabled && (
        <p className="chat-paused">チャットは一時お休み中です。</p>
      )}
      {error && (
        <p className="error" role="alert">
          {error} 入力は残っています。
        </p>
      )}
      <form
        className="chat-compose"
        onSubmit={async (e) => {
          e.preventDefault();
          if (composing.current || !text.trim() || !connected || busy) return;
          if (!draft.current || draft.current.body !== text)
            draft.current = { id: crypto.randomUUID(), body: text };
          if (
            await send({
              action: "message",
              messageId: draft.current.id,
              body: text,
            })
          ) {
            setText("");
            draft.current = undefined;
            follow.current = true;
          }
        }}
      >
        <label
          className="sr-only"
          htmlFor={host ? "mc-message" : "guest-message"}
        >
          {host ? "司会からメッセージ" : "みんなへメッセージ"}
        </label>
        <textarea
          id={host ? "mc-message" : "guest-message"}
          rows={2}
          maxLength={280}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          placeholder={
            host ? "例：次はお肉のギフト！" : "景品ほしい！ おめでとう！"
          }
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              (e.nativeEvent.isComposing || composing.current)
            )
              e.stopPropagation();
          }}
        />
        <div>
          <small>{[...text].length}/140</small>
          <button
            className="button primary"
            disabled={
              !text.trim() ||
              [...text].length > 140 ||
              busy ||
              !connected ||
              (!host && !live?.chatEnabled)
            }
          >
            {busy ? "送信中…" : "送信"}
          </button>
        </div>
      </form>
    </>
  );
  return host ? (
    <section className="panel community-panel">{content}</section>
  ) : (
    <>
      <button className="chat-launch" onClick={() => setOpen(true)}>
        みんなの声 <span>チャット ↗</span>
      </button>
      <dialog
        className="chat-dialog"
        ref={dialog}
        aria-label="みんなの声 チャット"
        onClose={() => setOpen(false)}
        onCancel={() => setOpen(false)}
      >
        {content}
      </dialog>
    </>
  );
}
