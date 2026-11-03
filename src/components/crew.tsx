"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, notifyRoom, savedSecret, saveSecret } from "@/lib/client";
import type { Handover } from "@/lib/handover";
import { PrizePicture } from "./prizes";
import { Logo } from "./ui";
export default function Crew({ id }: { id: string }) {
  const [key, setKey] = useState<string | null>(),
    [data, setData] = useState<{ title: string; items: Handover[] }>(),
    [error, setError] = useState(""),
    [connected, setConnected] = useState(false),
    [success, setSuccess] = useState(""),
    [generation, setGeneration] = useState(0);
  const update = useCallback(() => setGeneration((n) => n + 1), []);
  useEffect(() => {
    const value = new URLSearchParams(location.hash.slice(1)).get("key");
    if (value && /^[A-Za-z0-9_-]{43}$/.test(value)) {
      saveSecret(`bingo-crew-${id}`, value);
      history.replaceState(null, "", location.pathname);
      setKey(value);
    } else setKey(savedSecret(`bingo-crew-${id}`));
  }, [id]);
  useEffect(() => {
    if (!key) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let current: AbortController;
    async function poll() {
      if (stopped || document.hidden || !navigator.onLine) return;
      current = new AbortController();
      try {
        const result = await api<{ title: string; items: Handover[] }>(
          `/api/rooms/${id}/crew`,
          {
            headers: { Authorization: `Bearer ${key}` },
            signal: current.signal,
          },
        );
        if (!stopped) {
          setData(result);
          setConnected(true);
          setError("");
        }
      } catch (e) {
        if (!stopped) {
          setConnected(false);
          setError(e instanceof Error ? e.message : "接続を確認してください。");
        }
      } finally {
        if (!stopped) timer = setTimeout(poll, 3000);
      }
    }
    const resume = () => {
      clearTimeout(timer);
      if (!navigator.onLine) {
        setConnected(false);
        current?.abort();
      } else if (!document.hidden) void poll();
    };
    void poll();
    window.addEventListener("online", resume);
    window.addEventListener("offline", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      stopped = true;
      clearTimeout(timer);
      current?.abort();
      window.removeEventListener("online", resume);
      window.removeEventListener("offline", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [id, key, generation]);
  const items = data?.items || [];
  return (
    <div className="crew-app">
      <header>
        <Logo />
        <span>景品係</span>
      </header>
      <main>
        <p className="section-label">{data?.title || "景品の受け渡し"}</p>
        <h1>
          受け渡し待ち <b>{items.filter((i) => !i.deliveredAt).length}</b>
        </h1>
        <p>参加者の画面の6桁を確認し、完了表示が出てから手渡してください。</p>
        {key === null ? (
          <p className="notice">幹事から景品係用リンクを受け取ってください。</p>
        ) : null}
        {!connected && key && (
          <div className="notice" role="status">
            接続を確認中です。受け渡しを止めてお待ちください。
            <button onClick={update}>再確認</button>
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {success && (
          <p className="handover-confirmed" role="status">
            {success}
          </p>
        )}
        {items
          .filter((i) => !i.deliveredAt)
          .map((item) => (
            <HandoverRow
              key={item.id}
              item={item}
              id={id}
              secret={key!}
              connected={connected}
              update={(result) => {
                setData(result);
                setSuccess(
                  `✓ ${item.playerName}さんの「${item.prizeName}」の受け渡しを確定しました。手渡してください。`,
                );
                notifyRoom(id);
              }}
            />
          ))}
        {!items.some((i) => !i.deliveredAt) && data && (
          <div className="crew-empty">✓ 受け渡し待ちはありません</div>
        )}
        <details>
          <summary>
            受け渡し済み {items.filter((i) => i.deliveredAt).length}個
          </summary>
          {items
            .filter((i) => i.deliveredAt)
            .map((item) => (
              <HandoverRow
                key={item.id}
                item={item}
                id={id}
                secret={key!}
                connected={connected}
                update={(result) => {
                  setData(result);
                  setSuccess(
                    `${item.playerName}さんの「${item.prizeName}」を受け渡し待ちに戻しました。`,
                  );
                  notifyRoom(id);
                }}
              />
            ))}
        </details>
      </main>
    </div>
  );
}
function HandoverRow({
  id,
  secret,
  item,
  connected,
  update,
}: {
  id: string;
  secret: string;
  item: Handover;
  connected: boolean;
  update: (result: { title: string; items: Handover[] }) => void;
}) {
  const [code, setCode] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false);
  return (
    <article className={`handover-row ${item.deliveredAt ? "delivered" : ""}`}>
      <PrizePicture
        roomId={id}
        prize={{ name: item.prizeName, imageKey: item.imageKey }}
      />
      <div>
        <span>第{item.gameNumber}ゲーム</span>
        <h2>
          {item.playerName}
          <small>さん</small>
        </h2>
        <h3>{item.prizeName}</h3>
        {item.deliveredAt ? (
          <p className="handover-success" role="status">
            ✓ 受け渡し完了
          </p>
        ) : null}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (lock.current || !connected) return;
            if (
              item.deliveredAt &&
              !confirm(
                "手元に景品が戻っていることを確認しましたか？受け渡し済みを取り消します。",
              )
            )
              return;
            lock.current = true;
            setBusy(true);
            setError("");
            try {
              update(
                await api(`/api/rooms/${id}/crew`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${secret}`,
                  },
                  body: JSON.stringify({
                    awardId: item.id,
                    playerId: item.playerId,
                    claimCode: code,
                    expectedDeliveredAt: item.deliveredAt,
                    undo: !!item.deliveredAt,
                  }),
                }),
              );
              setCode("");
            } catch (e) {
              setError(
                e instanceof Error
                  ? e.message
                  : "受け渡しを保存できませんでした。",
              );
            } finally {
              lock.current = false;
              setBusy(false);
            }
          }}
        >
          {!item.deliveredAt && (
            <label>
              参加者の受け取り番号
              <input
                aria-label={`${item.playerName}さんの受け取り番号`}
                inputMode="numeric"
                autoComplete="off"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="6桁の番号"
                required
              />
            </label>
          )}
          <button
            className={item.deliveredAt ? "text-link" : "button primary"}
            disabled={
              !connected || busy || (!item.deliveredAt && code.length !== 6)
            }
          >
            {busy
              ? "保存中…"
              : item.deliveredAt
                ? "受け渡しを取り消す"
                : "受け渡しを確定"}
          </button>
        </form>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </article>
  );
}
