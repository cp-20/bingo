"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Card, Prize, RoomView } from "@/lib/game";
import { cardStatus } from "@/lib/card";
import {
  api,
  apiBlob,
  clientSecret,
  savedSecret,
  saveSecret,
  RequestError,
} from "@/lib/client";
import { Arrow, BingoCard, Logo, NumberBoard } from "./ui";

type Role = "host" | "player" | "screen";
function useRoomKey(id: string, role: Role) {
  const [key, setKey] = useState<string | null | undefined>();
  useEffect(() => {
    if (role === "screen") {
      setKey(null);
      return;
    }
    const parameter = role === "host" ? "key" : "card";
    const storageKey = `bingo-${role === "host" ? "host" : "player"}-${id}`;
    const fromLink = new URLSearchParams(location.hash.slice(1)).get(parameter);
    if (fromLink && /^[A-Za-z0-9_-]{43}$/.test(fromLink)) {
      saveSecret(storageKey, fromLink);
      history.replaceState(null, "", location.pathname + location.search);
      setKey(fromLink);
    } else setKey(savedSecret(storageKey));
  }, [id, role]);
  const remember = useCallback(
    (secret: string) => {
      saveSecret(`bingo-player-${id}`, secret);
      setKey(secret);
    },
    [id],
  );
  return { key, remember };
}
function useRoom(id: string, role: Role, key: string | null | undefined) {
  const [view, setView] = useState<RoomView>();
  const viewRef = useRef<RoomView | undefined>(undefined);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [generation, setGeneration] = useState(0);
  const refresh = useCallback(() => {
    setConnected(false);
    setGeneration((n) => n + 1);
  }, []);
  const acceptView = useCallback(
    (next: RoomView) => {
      if (
        next.id !== id ||
        (viewRef.current?.id === id && next.revision < viewRef.current.revision)
      )
        return;
      viewRef.current = next;
      setView(next);
      setError("");
      setConnected(true);
      setLastSync(Date.now());
    },
    [id],
  );
  useEffect(() => {
    if (key === undefined || (role === "host" && !key)) return;
    let stopped = false,
      first = true,
      inFlight = false,
      failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current: AbortController | undefined;
    async function poll() {
      if (stopped || inFlight || !navigator.onLine || document.hidden) return;
      inFlight = true;
      current = new AbortController();
      let terminal = false,
        wait = 4000;
      try {
        const revision = first ? undefined : viewRef.current?.revision;
        const headers: Record<string, string> = key
          ? {
              [role === "host" ? "Authorization" : "X-Player-Key"]:
                role === "host" ? `Bearer ${key}` : key,
            }
          : {};
        const next = await api<RoomView | null>(
          `/api/rooms/${id}${revision ? `?revision=${revision}` : ""}`,
          { headers, signal: current.signal },
        );
        if (stopped) return;
        if (next) acceptView(next);
        setError("");
        setConnected(true);
        setLastSync(Date.now());
        failures = 0;
        first = false;
      } catch (error) {
        if (stopped) return;
        failures++;
        setConnected(false);
        terminal =
          error instanceof RequestError &&
          [401, 404, 410].includes(error.status);
        wait =
          error instanceof RequestError && error.retryAfter
            ? Math.min(60000, error.retryAfter)
            : Math.min(30000, 4000 * 2 ** failures);
        setError(
          error instanceof Error ? error.message : "接続を確認しています。",
        );
      } finally {
        inFlight = false;
        if (!stopped && !terminal && navigator.onLine && !document.hidden)
          timer = setTimeout(poll, wait + Math.random() * 1500);
      }
    }
    const resume = () => {
      clearTimeout(timer);
      if (!navigator.onLine) {
        current?.abort();
        setConnected(false);
        setError(
          "インターネットに接続されていません。カードを閉じずに、回線の復旧をお待ちください。",
        );
      } else if (!document.hidden) {
        setConnected(false);
        first = true;
        void poll();
      } else {
        current?.abort();
        setConnected(false);
      }
    };
    void poll();
    if (!navigator.onLine) resume();
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
  }, [id, key, role, generation, acceptView]);
  return { view, error, connected, lastSync, refresh, acceptView };
}

function Connection({ connected }: { connected: boolean }) {
  return (
    <span className={`connection ${connected ? "online" : ""}`}>
      <i />
      {connected ? "接続中" : "再接続中"}
    </span>
  );
}
function RoomError({ error, refresh }: { error: string; refresh: () => void }) {
  return error ? (
    <div className="room-error" role="alert">
      {error}
      <button onClick={refresh}>再読み込み</button>
    </div>
  ) : null;
}
function QrCode({ url }: { url: string }) {
  const [image, setImage] = useState("");
  useEffect(() => {
    let active = true;
    import("qrcode")
      .then((qr) =>
        qr.toDataURL(url, {
          width: 280,
          margin: 2,
          errorCorrectionLevel: "M",
          color: { dark: "#164c3d", light: "#ffffff" },
        }),
      )
      .then((src) => {
        if (active) setImage(src);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [url]);
  return image ? (
    <img src={image} width="220" height="220" alt="イベント参加用QRコード" />
  ) : (
    <div className="qr-loading" aria-label="QRコードを準備中">
      ▦
    </div>
  );
}

export default function RoomClient({ id, role }: { id: string; role: Role }) {
  const { key, remember } = useRoomKey(id, role);
  const { view, error, connected, lastSync, refresh, acceptView } = useRoom(
    id,
    role,
    key,
  );
  const [origin, setOrigin] = useState("");
  const [toast, setToast] = useState("");
  useEffect(() => setOrigin(location.origin), []);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setToast("コピーしました");
    } catch {
      window.prompt("リンクを選択してコピーしてください。", text);
      setToast("コピーできませんでした。リンクを選択してコピーしてください。");
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(""), 4000);
  }
  const joinUrl = `${origin}/join/${id}`;
  if (role === "host" && key === null)
    return (
      <main className="simple-page">
        <Logo />
        <h1>幹事用リンクが必要です。</h1>
        <p>
          保存した幹事用リンクを開くか、イベントを作成した端末・ブラウザから開いてください。
        </p>
        <Link href="/" className="button primary">
          ホームへ戻る
        </Link>
      </main>
    );
  if (!view || view.id !== id)
    return (
      <main className="simple-page">
        <Logo />
        {error ? (
          <RoomError error={error} refresh={refresh} />
        ) : (
          <>
            <div className="loading-orbit" />
            <p>会場につないでいます…</p>
          </>
        )}
      </main>
    );
  return (
    <div className={`room-app role-${role}`}>
      <header className="room-header">
        <Logo light={role === "screen"} />
        <div>
          <span className="room-header-name">{view.title}</span>
          <Connection connected={connected} />
        </div>
        {role === "host" && (
          <Link href="/guide" target="_blank" className="text-link">
            使い方 ↗
          </Link>
        )}
      </header>
      <RoomError error={error} refresh={refresh} />
      <div className={`sync-banner ${connected ? "synced" : "stale"}`}>
        <span role="status">
          {connected
            ? "● 最新の状態を確認済み"
            : "◷ 再接続中 — 表示は最後に確認できた状態です。操作を停止しています。"}
        </span>
        {lastSync && (
          <span aria-hidden="true">
            最終同期{" "}
            {new Date(lastSync).toLocaleTimeString("ja-JP", {
              timeZone: "Asia/Tokyo",
            })}
          </span>
        )}
      </div>
      {role === "host" ? (
        <Host
          view={view}
          hostKey={key!}
          refresh={refresh}
          joinUrl={joinUrl}
          copy={copy}
          connected={connected}
          onView={acceptView}
        />
      ) : role === "screen" ? (
        <Screen view={view} joinUrl={joinUrl} />
      ) : (
        <Participant
          view={view}
          refresh={refresh}
          connected={connected}
          playerKey={key || null}
          rememberKey={remember}
          copy={copy}
          onJoined={(secret, room) => {
            remember(secret);
            acceptView(room);
          }}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          ✓ {toast}
        </div>
      )}
      {role !== "screen" && (
        <div className="room-bottom">
          いい時間に、いいビンゴを。<span>BINGO ROOM</span>
        </div>
      )}
    </div>
  );
}

function Host({
  view,
  hostKey,
  refresh,
  joinUrl,
  copy,
  connected,
  onView,
}: {
  view: RoomView;
  hostKey: string;
  refresh: () => void;
  joinUrl: string;
  copy: (text: string) => void;
  connected: boolean;
  onView: (view: RoomView) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [prizeName, setPrizeName] = useState("");
  const prizeId = useRef<string | null>(null);
  const mutation = useRef(false);
  const [rolling, setRolling] = useState(false);
  const [paymentReturn, setPaymentReturn] = useState(false);
  useEffect(
    () =>
      setPaymentReturn(
        new URLSearchParams(location.search).get("payment") === "return",
      ),
    [],
  );
  async function action(input: Record<string, unknown>) {
    if (mutation.current || !connected) return false;
    mutation.current = true;
    setBusy(true);
    setError("");
    if (input.action === "draw") setRolling(true);
    try {
      const data = await api<{ room: RoomView }>(
        `/api/rooms/${view.id}/action`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${hostKey}`,
          },
          body: JSON.stringify({
            ...input,
            expectedGameNumber: view.gameNumber,
          }),
        },
      );
      onView(data.room);
      return true;
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "操作できませんでした。",
      );
      refresh();
      return false;
    } finally {
      mutation.current = false;
      setBusy(false);
      setRolling(false);
    }
  }
  async function upgrade() {
    if (mutation.current || !connected) return;
    mutation.current = true;
    setBusy(true);
    setError("");
    try {
      const data = await api<{ url: string }>(
        `/api/rooms/${view.id}/checkout`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${hostKey}` },
        },
        25000,
      );
      const url = new URL(data.url);
      if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com")
        throw new Error("決済画面を開けませんでした。");
      location.assign(url.href);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "決済を開始できませんでした。",
      );
      setBusy(false);
      mutation.current = false;
      refresh();
    }
  }
  async function downloadCsv() {
    try {
      const blob = await apiBlob(`/api/rooms/${view.id}/export`, {
        headers: { Authorization: `Bearer ${hostKey}` },
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `bingo-${view.id}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "結果を保存できませんでした。",
      );
    }
  }
  const latest = view.drawn.at(-1);
  return (
    <main className="host-main">
      <div className="dashboard-title">
        <div>
          <span className="eyebrow">YOUR EVENT ROOM</span>
          <h1>{view.title}</h1>
          <span className={`event-status ${view.status}`}>
            <span>第{view.gameNumber}ゲーム · </span>
            {view.status === "lobby"
              ? "● 参加受付中"
              : view.status === "playing"
                ? "● ゲーム進行中・新規受付終了"
                : "✓ イベント終了"}
          </span>
        </div>
        <div className="dashboard-actions">
          <button
            className="button outline small"
            onClick={() => copy(joinUrl)}
          >
            参加URLをコピー ↗
          </button>
          <Link
            href={`/screen/${view.id}`}
            className="button primary small"
            target="_blank"
          >
            会場スクリーンを開く ↗
          </Link>
        </div>
      </div>
      <div className="host-save-banner">
        <span>⌘</span>
        <div>
          <b>幹事用リンクを、いま保存しましょう。</b>
          <p>
            別の端末で再開するときに必要です。参加者には共有しないでください。
          </p>
        </div>
        <button
          onClick={() =>
            copy(`${location.origin}/host/${view.id}#key=${hostKey}`)
          }
        >
          幹事用リンクをコピー ↗
        </button>
      </div>
      {paymentReturn && view.plan === "free" && (
        <div className="notice" role="status">
          {view.paymentStatus === "failed"
            ? "お支払いが完了していません。人数制限は解除されていません。接続を確認し、もう一度お試しください。"
            : "Stripeの決済結果を確認しています。反映まで少しお待ちください。"}
          <button onClick={refresh}>確認する</button>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {view.status === "lobby" && (
        <Invitation
          view={view}
          joinUrl={joinUrl}
          copy={copy}
          className="lobby-mobile-invite"
        />
      )}
      <div className="stats-grid">
        <div>
          <span>PARTICIPANTS</span>
          <strong>
            {view.count}
            <small>/ {view.limit}人</small>
          </strong>
        </div>
        <div>
          <span>NUMBERS DRAWN</span>
          <strong>
            {view.drawn.length}
            <small>/ 75</small>
          </strong>
        </div>
        <div>
          <span>BINGO!</span>
          <strong>
            {view.winners.length}
            <small>人</small>
          </strong>
        </div>
        <div>
          <span>ROOM PLAN</span>
          <strong className="plan-stat">
            {view.plan === "event" ? "EVENT" : "FREE"}
            <small>
              {view.plan === "event" ? "テスト決済済み" : "30人まで無料"}
            </small>
          </strong>
        </div>
      </div>
      <div className="dashboard-grid">
        <div className="dashboard-left">
          <section className="draw-panel">
            <div className="panel-heading">
              <h2>抽選ルーム</h2>
              <span>
                {view.drawn.length
                  ? `第${view.drawn.length}回`
                  : "READY WHEN YOU ARE"}
              </span>
            </div>
            <div className="draw-stage">
              <span className="draw-kicker">
                {view.status === "finished"
                  ? "THANK YOU FOR PLAYING"
                  : latest
                    ? "LUCKY NUMBER"
                    : "LET’S GET STARTED"}
              </span>
              <div
                aria-live="polite"
                className={`big-number ${rolling ? "rolling" : ""}`}
              >
                {rolling ? "…" : latest || "?"}
              </div>
              <div className="draw-history">
                {view.drawn.length ? (
                  view.drawn
                    .slice(-5)
                    .reverse()
                    .map((n, i) => (
                      <span key={n} className={i === 0 ? "current" : ""}>
                        {n}
                      </span>
                    ))
                ) : (
                  <span className="empty-history">
                    みんなが集まったら、はじめましょう。
                  </span>
                )}
              </div>
              <button
                className="button draw-button"
                disabled={
                  busy ||
                  !connected ||
                  !view.count ||
                  view.status === "finished" ||
                  view.drawn.length === 75
                }
                onClick={() =>
                  void action({
                    action: "draw",
                    expectedDrawCount: view.drawn.length,
                  })
                }
              >
                {busy && rolling
                  ? "抽選中…"
                  : view.drawn.length
                    ? "次の番号をひく"
                    : "最初の番号をひく"}
                <Arrow />
              </button>
              <small>最初の抽選で新規参加の受付が終了します。</small>
            </div>
            <NumberBoard drawn={view.drawn} />
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h2>
                参加者と当選結果 <span>{view.count}</span>
              </h2>
              <button
                className="text-link"
                onClick={downloadCsv}
                disabled={!connected || busy}
              >
                CSV保存 ↓
              </button>
            </div>
            {view.players?.length ? (
              <div className="players-list">
                {view.players.map((p) => (
                  <div
                    className={`player-row ${p.bingoAt ? "winner" : ""}`}
                    key={p.id}
                  >
                    <span className="avatar">{p.name.slice(0, 1)}</span>
                    <b>{p.name}</b>
                    <span>
                      {p.rank
                        ? `${p.rank}位${view.winners.filter((w) => w.rank === p.rank).length > 1 ? "（同着）" : ""}`
                        : "参加中"}
                    </span>
                    <small>
                      {view.prizes.find((prize) => prize.playerId === p.id)
                        ?.name || (p.bingoAt ? "BINGO!" : "—")}
                    </small>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                まだ静かな会場です。
                <br />
                QRコードをシェアして、みんなを呼びましょう。
              </div>
            )}
          </section>
        </div>
        <aside className="dashboard-right">
          <Invitation
            view={view}
            joinUrl={joinUrl}
            copy={copy}
            className={view.status === "lobby" ? "lobby-desktop-invite" : ""}
          />
          <section className="panel prizes-panel">
            <div className="panel-heading">
              <h2>景品リスト</h2>
              <span>{view.prizes.length}個</span>
            </div>
            <form
              className="prize-form"
              onSubmit={async (e) => {
                e.preventDefault();
                prizeId.current ??= crypto.randomUUID();
                if (
                  await action({
                    action: "prize",
                    name: prizeName,
                    prizeId: prizeId.current,
                  })
                ) {
                  setPrizeName("");
                  prizeId.current = null;
                }
              }}
            >
              <label className="sr-only" htmlFor="prize-name">
                景品名
              </label>
              <input
                id="prize-name"
                placeholder="例：コーヒーギフト"
                maxLength={40}
                required
                value={prizeName}
                onChange={(e) => {
                  setPrizeName(e.target.value);
                  prizeId.current = null;
                }}
              />
              <button
                className="button primary"
                disabled={busy || !connected}
                aria-label="景品を追加"
              >
                ＋
              </button>
            </form>
            {view.prizes.length ? (
              view.prizes.map((prize, i) => (
                <PrizeRow
                  key={prize.id}
                  prize={prize}
                  view={view}
                  index={i}
                  busy={busy || !connected}
                  action={action}
                />
              ))
            ) : (
              <p className="empty-state compact">
                景品を登録すると、
                <br />
                当選者への割り当てができます。
              </p>
            )}
          </section>
          {view.plan === "free" && (
            <section className="upgrade-panel">
              <span className="eyebrow">MORE PEOPLE, MORE FUN.</span>
              <h3>31人以上で集まるなら。</h3>
              <p>
                最大300人・30日間
                <br />
                1イベント <b>¥2,980</b>
                <small>（税込）</small>
              </p>
              <button
                className="button primary wide small"
                disabled={busy || !connected || !view.paymentReady}
                onClick={upgrade}
              >
                {view.paymentReady
                  ? "sandboxでテスト決済 ↗"
                  : "テスト決済の受付準備中"}
              </button>
              <small>現在はテスト決済のみ。実際の請求はありません。</small>
            </section>
          )}
          <section className="room-tools">
            <span className="eyebrow">EVENT TOOLS</span>
            <Link href={`/host/${view.id}/print`} target="_blank">
              参加済みカードを印刷 ↗
            </Link>
            <button
              onClick={() => {
                if (
                  confirm(
                    "抽選結果と景品の割り当てをリセットします。参加者のカードは維持されます。よろしいですか？",
                  )
                )
                  void action({ action: "reset" });
              }}
              disabled={busy || !connected}
            >
              リハーサル・次のゲームへ ↻
            </button>
            <button
              onClick={() => {
                if (confirm("このゲームを終了します。結果は保存されます。"))
                  void action({ action: "finish" });
              }}
              disabled={busy || !connected || view.status === "finished"}
            >
              ゲームを終了する
            </button>
            <small>
              利用期限：
              {new Date(view.expiresAt).toLocaleDateString("ja-JP", {
                timeZone: "Asia/Tokyo",
              })}
            </small>
          </section>
        </aside>
      </div>
    </main>
  );
}

function Invitation({
  view,
  joinUrl,
  copy,
  className = "",
}: {
  view: RoomView;
  joinUrl: string;
  copy: (value: string) => void;
  className?: string;
}) {
  return (
    <section className={`panel join-panel ${className}`}>
      <div className="panel-heading">
        <h2>参加者を招待</h2>
        <span>SCAN & JOIN</span>
      </div>
      <QrCode url={joinUrl} />
      <b className="join-code-label">{view.id}</b>
      <p>
        QRを読むか、トップページで
        <br />
        この参加コードを入力してください。
      </p>
      <button
        className="button outline wide small"
        onClick={() => copy(joinUrl)}
      >
        参加URLをコピー ↗
      </button>
    </section>
  );
}

function PrizeRow({
  prize,
  view,
  index,
  busy,
  action,
}: {
  prize: Prize;
  view: RoomView;
  index: number;
  busy: boolean;
  action: (input: Record<string, unknown>) => Promise<boolean>;
}) {
  const [selected, setSelected] = useState("");
  const winner = view.winners.find((p) => p.id === prize.playerId);
  const eligible = view.winners.filter(
    (p) => !view.prizes.some((other) => other.playerId === p.id),
  );
  return (
    <div className="prize-row">
      <div>
        <span className="prize-order">
          {String(index + 1).padStart(2, "0")}
        </span>
        <b>{prize.name}</b>
        {winner && <span className="awarded">✓ {winner.name}</span>}
        {winner ? (
          <button
            className="text-link"
            disabled={busy}
            onClick={() => {
              if (
                confirm(
                  "景品の割り当てを取り消します。手渡し済みの場合は受け渡しも確認してください。",
                )
              )
                void action({ action: "unaward", prizeId: prize.id });
            }}
          >
            当選者を変更
          </button>
        ) : (
          <button
            className="prize-remove"
            aria-label={`${prize.name}を削除`}
            disabled={busy}
            onClick={() => {
              if (confirm(`「${prize.name}」を削除しますか？`))
                void action({ action: "remove_prize", prizeId: prize.id });
            }}
          >
            ×
          </button>
        )}
      </div>
      {!winner && eligible.length > 0 && (
        <div className="award-controls">
          <label className="sr-only" htmlFor={`award-${prize.id}`}>
            当選者を選択
          </label>
          <select
            id={`award-${prize.id}`}
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">当選者を選択</option>
            {eligible.map((p) => (
              <option key={p.id} value={p.id}>
                {p.rank}位 {p.name}
              </option>
            ))}
          </select>
          <button
            disabled={!selected || busy}
            onClick={() => {
              const name = eligible.find((p) => p.id === selected)?.name;
              if (confirm(`「${prize.name}」を${name}さんに割り当てますか？`))
                void action({
                  action: "award",
                  prizeId: prize.id,
                  playerId: selected,
                });
            }}
          >
            確定
          </button>
        </div>
      )}
    </div>
  );
}

function Participant({
  view,
  refresh,
  connected,
  playerKey,
  copy,
  onJoined,
  rememberKey,
}: {
  view: RoomView;
  refresh: () => void;
  connected: boolean;
  playerKey: string | null;
  copy: (value: string) => void;
  onJoined: (secret: string, room: RoomView) => void;
  rememberKey: (secret: string) => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const me = view.me;
  if (!me)
    return (
      <main className="participant-entry">
        <div className="entry-art">✳</div>
        <span className="eyebrow">YOU’RE INVITED!</span>
        <h1>{view.title}</h1>
        <p>
          いつもの名前で、気軽に参加。
          <br />
          あなた専用のビンゴカードが届きます。
        </p>
        {view.status === "lobby" ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy || !connected) return;
              setBusy(true);
              setError("");
              try {
                const joinKey =
                  playerKey ||
                  savedSecret(`bingo-player-${view.id}`) ||
                  clientSecret();
                saveSecret(`bingo-player-${view.id}`, joinKey);
                rememberKey(joinKey);
                const data = await api<{ room: RoomView; playerKey: string }>(
                  `/api/rooms/${view.id}/join`,
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name, joinKey }),
                  },
                );
                onJoined(data.playerKey, data.room);
              } catch (error) {
                setError(
                  error instanceof Error
                    ? error.message
                    : "参加できませんでした。",
                );
                refresh();
              } finally {
                setBusy(false);
              }
            }}
          >
            <label htmlFor="player-name">会場で表示するニックネーム</label>
            <input
              id="player-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={20}
              required
              autoComplete="nickname"
              placeholder="例：ビンゴ太郎"
            />
            <button
              className="button primary wide"
              disabled={busy || !connected}
            >
              {busy ? "カードを準備しています…" : "ビンゴに参加する"}
              <Arrow />
            </button>
            <small>
              ニックネームは幹事・会場スクリーンに表示されます。
              <br />
              参加後に復帰リンクを保存しておくと、別端末でも同じカードに戻れます。
            </small>
          </form>
        ) : (
          <div className="notice">
            {view.status === "finished"
              ? "このゲームは終了しました。"
              : "ゲームが始まったため、受付は終了しました。幹事にお声がけください。"}
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <span className="entry-count">
          {view.count}人が参加中 / 最大{view.limit}人
        </span>
        <Link href="/privacy" className="fineprint">
          プライバシーポリシー
        </Link>
      </main>
    );
  const status = cardStatus(me.card, view.drawn);
  const prize = view.prizes.find((p) => p.playerId === me.id);
  return (
    <main className={`participant-main ${status.bingo ? "has-bingo" : ""}`}>
      <div className="participant-greeting">
        <span className="eyebrow">YOUR LUCKY CARD</span>
        <h1>
          {me.name}
          <small>さんのカード</small>
        </h1>
      </div>
      <div
        className={`card-status ${status.bingo ? "bingo-status" : status.reach ? "reach-status" : ""}`}
        role="status"
      >
        {view.status === "finished"
          ? "THANK YOU! また遊びましょう。"
          : status.bingo
            ? `✦ BINGO! おめでとう！ ${me.rank}位 ✦`
            : status.reach
              ? `✦ リーチ！あとひとつ。`
              : view.status === "lobby"
                ? "みんなが集まるまで、もう少し。"
                : "次の番号は、あなたのラッキーナンバーかも。"}
      </div>
      <BingoCard card={me.card} drawn={view.drawn} />
      {playerKey && (
        <button
          className="button outline wide recovery-button"
          onClick={() =>
            copy(`${location.origin}/join/${view.id}#card=${playerKey}`)
          }
        >
          カードの復帰リンクを保存 ↗
        </button>
      )}
      {playerKey && (
        <p className="recovery-help">
          このリンクはあなただけのものです。他の人に共有しないでください。
        </p>
      )}
      {prize && (
        <div className="won-prize">
          <span>YOUR GIFT</span>
          <h2>🎁 {prize.name}</h2>
          <p>幹事に名前を伝えて、景品を受け取ってください。</p>
        </div>
      )}
      <div className="participant-latest">
        <span>いま出た番号</span>
        <strong aria-live="polite">{view.drawn.at(-1) || "—"}</strong>
        <span>{view.drawn.length} / 75 回目</span>
      </div>
      <p className="participant-help">
        カードは自動で開きます。ビンゴの申告も不要です。
        <br />
        通信が切れてもカードを閉じず、回線の復旧をお待ちください。
      </p>
      <details className="drawn-details">
        <summary>これまでに出た番号を見る</summary>
        <NumberBoard drawn={view.drawn} />
      </details>
    </main>
  );
}

function Screen({ view, joinUrl }: { view: RoomView; joinUrl: string }) {
  return (
    <main className="screen-main">
      <div className="screen-title">
        <span className="eyebrow">LET THE GOOD TIMES ROLL</span>
        <h1>{view.title}</h1>
      </div>
      <div className="screen-layout">
        <section className="screen-draw">
          <span>
            {view.status === "lobby"
              ? "みんな、準備はいい？"
              : view.status === "finished"
                ? "THANK YOU FOR PLAYING!"
                : `第${view.drawn.length}回 LUCKY NUMBER`}
          </span>
          <strong key={view.drawn.length} aria-live="polite">
            {view.drawn.at(-1) || "?"}
          </strong>
          <div className="screen-recent">
            {view.drawn
              .slice(-6)
              .reverse()
              .map((n) => (
                <b key={n}>{n}</b>
              ))}
          </div>
        </section>
        <aside className="screen-join">
          <QrCode url={joinUrl} />
          <b>{view.id}</b>
          <span>QRコードから参加</span>
          <small>
            {view.count}人が参加中 · ビンゴ {view.winners.length}人
          </small>
          {view.status !== "lobby" && (
            <small>新規参加の受付は終了しています</small>
          )}
        </aside>
      </div>
      <NumberBoard drawn={view.drawn} />
      {view.winners.length > 0 && (
        <section className="screen-winners">
          <span>BINGO!</span>
          {view.winners.map((p) => (
            <b key={p.id}>
              {p.rank}位 {p.name}
              <small>
                {view.prizes.find((prize) => prize.playerId === p.id)?.name}
              </small>
            </b>
          ))}
        </section>
      )}
    </main>
  );
}

export function PrintCards({ id }: { id: string }) {
  const { key } = useRoomKey(id, "host");
  const [cards, setCards] = useState<
    { id: string; name: string; card: Card }[]
  >([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!key) return;
    let active = true;
    api<{ id: string; name: string; card: Card }[]>(
      `/api/rooms/${id}/export?format=cards`,
      {
        headers: { Authorization: `Bearer ${key}` },
      },
    )
      .then((data) => {
        if (active) setCards(data);
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, [id, key]);
  return (
    <main className="print-page">
      <div className="print-header">
        <Logo />
        <h1>参加済みカードのバックアップ</h1>
        <p>
          同じカードを紙でも用意できます。通信が切れた場合は画面の抽選番号を読み上げ、手動でチェックしてください。
          <br />
          紙のチェック内容はスマホに送信されません。景品の配布は幹事が確認してください。
        </p>
        <button
          className="button primary"
          onClick={() => window.print()}
          disabled={!cards.length}
        >
          印刷する
        </button>
        {key === null && (
          <p className="error">幹事用リンクから開いてください。</p>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {key && !cards.length && !error && (
          <p>参加者が入るとカードを印刷できます。</p>
        )}
      </div>
      <div className="print-grid">
        {cards.map((p) => (
          <article key={p.id}>
            <h2>{p.name}</h2>
            <small>
              {id} · {p.id.slice(0, 6)}
            </small>
            <BingoCard card={p.card} />
          </article>
        ))}
      </div>
    </main>
  );
}
