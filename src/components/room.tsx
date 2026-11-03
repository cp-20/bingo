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
import { Arrow, BingoCard, DrawBall, Logo, NumberBoard } from "./ui";
import { Celebration, useCelebration } from "./celebration";

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
          `/api/rooms/${id}?${new URLSearchParams({ ...(revision ? { revision: String(revision) } : {}), ...(role === "player" ? { view: "card" } : {}) })}`,
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
          width: 640,
          margin: 2,
          errorCorrectionLevel: "M",
          color: { dark: "#202020", light: "#ffffff" },
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
    <div className={`room-app role-${role} state-${view.status}`}>
      {role !== "screen" && (
        <header className="room-header">
          <Logo />
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
      )}
      {!connected && (
        <div className="sync-banner stale" role="status">
          <p>
            再接続中 — 表示は最後に確認できた状態です。操作を停止しています。
          </p>
          {error && <p>{error}</p>}
          <button onClick={refresh}>接続を再確認</button>
          {lastSync && (
            <small>
              最終同期{" "}
              {new Date(lastSync).toLocaleTimeString("ja-JP", {
                timeZone: "Asia/Tokyo",
              })}
            </small>
          )}
        </div>
      )}
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
        <Screen view={view} joinUrl={joinUrl} connected={connected} />
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
          {toast}
        </div>
      )}
      {role !== "screen" && (
        <div className="room-bottom">
          <span>BINGO ROOM</span>
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
  const [search, setSearch] = useState("");
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
    if (mutation.current || !connected) return;
    mutation.current = true;
    setBusy(true);
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
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  }
  const latest = view.drawn.at(-1);
  const lobby = view.status === "lobby";
  const finished = view.status === "finished";
  const listed = (view.players || []).filter((player) =>
    player.name
      .normalize("NFKC")
      .toLocaleLowerCase("ja")
      .includes(search.normalize("NFKC").toLocaleLowerCase("ja")),
  );
  function draw() {
    if (
      !view.drawn.length &&
      !confirm(
        `参加者は${view.count}人です。抽選を始めると新規参加の受付が終了します。開始しますか？`,
      )
    )
      return;
    void action({ action: "draw", expectedDrawCount: view.drawn.length });
  }
  function reset() {
    if (
      confirm(
        "抽選結果と景品の割り当てをリセットします。参加者のカードは維持されます。よろしいですか？",
      )
    )
      void action({ action: "reset" });
  }
  const prizePanel = (
    <section className="panel prizes-panel">
      <div className="panel-heading">
        <h2>{lobby ? "景品の準備" : "景品の受け渡し"}</h2>
        <span>
          {view.prizes.filter((prize) => prize.playerId).length} /{" "}
          {view.prizes.length}個
        </span>
      </div>
      <details className="prize-editor" open={lobby}>
        <summary>景品を追加する</summary>
        <form
          className="prize-form"
          onSubmit={async (event) => {
            event.preventDefault();
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
            onChange={(event) => {
              setPrizeName(event.target.value);
              prizeId.current = null;
            }}
          />
          <button
            className="button primary"
            disabled={busy || !connected}
            aria-label="景品を追加"
          >
            追加
          </button>
        </form>
      </details>
      {view.prizes.length ? (
        view.prizes.map((prize, index) => (
          <PrizeRow
            key={prize.id}
            prize={prize}
            view={view}
            index={index}
            busy={busy || !connected}
            action={action}
          />
        ))
      ) : (
        <p className="empty-state compact">
          景品がある場合は、先に名前を登録しておけます。
        </p>
      )}
    </section>
  );
  return (
    <main id="main-content" className="host-main">
      <div className="dashboard-title">
        <div>
          <p className={`event-status ${view.status}`}>
            第{view.gameNumber}ゲーム ·{" "}
            {lobby ? "参加受付中" : finished ? "終了" : "抽選中・新規受付終了"}
          </p>
          <h1>{view.title}</h1>
        </div>
        <div className="dashboard-actions">
          <Link
            href={`/screen/${view.id}`}
            className="button primary"
            target="_blank"
          >
            会場スクリーンを開く <Arrow diagonal />
          </Link>
        </div>
      </div>
      {lobby && (
        <div className="host-save-banner">
          <p>幹事用リンクを保存すると、別の端末からも進行できます。</p>
          <button
            className="text-link"
            onClick={() =>
              copy(`${location.origin}/host/${view.id}#key=${hostKey}`)
            }
          >
            幹事用リンクをコピー
          </button>
        </div>
      )}
      {paymentReturn && view.plan === "free" && (
        <div className="notice" role="status">
          {view.paymentStatus === "failed"
            ? "テスト決済は完了していません。人数制限は解除されていません。"
            : "Stripeのテスト決済結果を確認しています。"}
          <button onClick={refresh}>確認する</button>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="stats-grid">
        <div>
          <span>参加者</span>
          <strong>
            {view.count}
            <small> / {view.limit}人</small>
          </strong>
        </div>
        <div>
          <span>抽選済み</span>
          <strong>
            {view.drawn.length}
            <small> / 75</small>
          </strong>
        </div>
        <div>
          <span>ビンゴ</span>
          <strong>
            {view.winners.length}
            <small>人</small>
          </strong>
        </div>
        <div>
          <span>{view.plan === "event" ? "イベントプラン" : "無料プラン"}</span>
          <small>{view.plan === "event" ? "テスト決済済み" : "30人まで"}</small>
        </div>
      </div>
      <div
        className={`host-workspace ${lobby ? "host-lobby" : "host-playing"}`}
      >
        {lobby && (
          <Invitation
            view={view}
            joinUrl={joinUrl}
            copy={copy}
            className="lobby-invite"
          />
        )}
        <section className="draw-panel" aria-label="抽選の操作">
          <div className="panel-heading">
            <h2>
              {lobby
                ? "みんながそろったら、スタート。"
                : finished
                  ? "このゲームの結果"
                  : "次の番号をひく"}
            </h2>
            <span>第{view.drawn.length}回</span>
          </div>
          <div className="draw-stage">
            <p className="draw-kicker">
              {rolling
                ? "抽選しています…"
                : latest
                  ? "いま出た番号"
                  : `${view.count}人が参加済み`}
            </p>
            <div aria-busy={rolling}>
              <DrawBall number={latest} className="big-number" />
            </div>
            <div className="draw-history">
              {view.drawn.length > 1 ? (
                <>
                  <span>ひとつ前</span>
                  {view.drawn
                    .slice(-5, -1)
                    .reverse()
                    .map((number) => (
                      <b key={number}>{number}</b>
                    ))}
                </>
              ) : (
                <span>
                  {lobby
                    ? "最初の抽選で、新規参加の受付が終了します。"
                    : finished
                      ? "結果はCSVで保存できます。"
                      : "最初の番号です"}
                </span>
              )}
            </div>
            <div className="host-draw-actions">
              <span className="draw-control-state">
                {finished ? "ゲーム終了" : `第${view.drawn.length}回`}
                <b>{latest || "—"}</b>
              </span>
              <button
                className="button draw-button"
                disabled={
                  busy ||
                  !connected ||
                  (!finished && (!view.count || view.drawn.length === 75))
                }
                onClick={finished ? reset : draw}
              >
                {busy && rolling
                  ? "抽選中…"
                  : finished
                    ? "次のゲームを準備する"
                    : view.drawn.length
                      ? "次の番号をひく"
                      : "最初の番号をひく"}
                <Arrow />
              </button>
            </div>
            <small>
              {finished
                ? "同じカードのまま、次のゲームを始められます。"
                : !view.count
                  ? "参加者が入ると抽選できます。"
                  : view.drawn.length === 75
                    ? "75個すべての番号を抽選しました。"
                    : lobby
                      ? "全員にカードがあることを確認してください。"
                      : "カードは参加者の画面で自動で開きます。"}
            </small>
          </div>
          {!lobby && <NumberBoard drawn={view.drawn} />}
        </section>
        {!lobby && (
          <div className="host-progress">
            <section className="panel results-panel">
              <div className="panel-heading">
                <h2>
                  ビンゴした人 <span>{view.winners.length}人</span>
                </h2>
                <button
                  className="text-link"
                  onClick={downloadCsv}
                  disabled={!connected || busy}
                >
                  CSVを保存
                </button>
              </div>
              {view.winners.length ? (
                <div
                  className="winner-list"
                  role="region"
                  aria-label="当選結果一覧"
                  tabIndex={0}
                >
                  {view.winners.map((player) => (
                    <div
                      className={`winner-row ${player.bingoAt === view.drawn.length ? "is-new" : ""}`}
                      key={player.id}
                    >
                      <span>{player.rank}位</span>
                      <strong>{player.name}</strong>
                      <small>
                        {view.prizes.find(
                          (prize) => prize.playerId === player.id,
                        )?.name || "景品未割り当て"}
                      </small>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="waiting-winners">
                  <p>ビンゴになると、ここに名前が届きます。</p>
                </div>
              )}
              {view.prizes.length > 0 && (
                <p className="winner-instruction">
                  下の景品から当選者を選び、受け渡しを進めてください。
                </p>
              )}
            </section>
            {prizePanel}
          </div>
        )}
      </div>
      <div className="host-management">
        {lobby && prizePanel}
        <div className="host-secondary">
          <details className="participant-register" open={lobby}>
            <summary>
              参加者一覧 <span>{view.count}人</span>
            </summary>
            <label className="sr-only" htmlFor="participant-search">
              参加者名で検索
            </label>
            <input
              id="participant-search"
              type="search"
              placeholder="名前で検索"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {search && <p className="search-count">{listed.length}人が一致</p>}
            <div
              className="players-list"
              role="region"
              aria-label="参加者一覧"
              tabIndex={0}
            >
              <table className="players-table">
                <caption className="sr-only">参加者と当選結果</caption>
                <thead>
                  <tr>
                    <th scope="col">名前</th>
                    <th scope="col">順位</th>
                    <th scope="col">景品</th>
                  </tr>
                </thead>
                <tbody>
                  {listed.map((player) => (
                    <tr
                      className={`player-row ${player.bingoAt ? "winner" : ""}`}
                      key={player.id}
                    >
                      <th scope="row">{player.name}</th>
                      <td>
                        {player.rank
                          ? `${player.rank}位${view.winners.filter((winner) => winner.rank === player.rank).length > 1 ? "（同着）" : ""}`
                          : "参加中"}
                      </td>
                      <td>
                        {view.prizes.find(
                          (prize) => prize.playerId === player.id,
                        )?.name || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!listed.length && (
                <p className="empty-state">
                  {view.count
                    ? "一致する名前はありません。"
                    : "まだ参加者はいません。"}
                </p>
              )}
            </div>
          </details>
          {!lobby && (
            <details className="card-return">
              <summary>参加URL・復帰用QR</summary>
              <Invitation view={view} joinUrl={joinUrl} copy={copy} />
            </details>
          )}
          <details className="room-tools">
            <summary>保存・イベント設定</summary>
            <button
              onClick={() =>
                copy(`${location.origin}/host/${view.id}#key=${hostKey}`)
              }
            >
              幹事用リンクをコピー
            </button>
            <Link href={`/host/${view.id}/print`} target="_blank">
              参加済みカードを印刷
            </Link>
            <button disabled={busy || !connected} onClick={reset}>
              リハーサル・次のゲームへ ↻
            </button>
            <button
              className="danger-action"
              disabled={busy || !connected || finished}
              onClick={() => {
                if (confirm("このゲームを終了します。結果は保存されます。"))
                  void action({ action: "finish" });
              }}
            >
              ゲームを終了する
            </button>
            <small>
              利用期限：
              {new Date(view.expiresAt).toLocaleDateString("ja-JP", {
                timeZone: "Asia/Tokyo",
              })}
            </small>
          </details>
          {view.plan === "free" && lobby && (
            <section className="upgrade-panel">
              <h2>31人以上の開催</h2>
              <p>
                最大300人・30日間 <strong>2,980円</strong>
                <small>税込／1イベント</small>
              </p>
              <button
                className="button wide"
                disabled={busy || !connected || !view.paymentReady}
                onClick={upgrade}
              >
                {view.paymentReady
                  ? "sandboxでテスト決済"
                  : "テスト決済の受付準備中"}
              </button>
              <small>現在はテスト決済のみ。実際の請求はありません。</small>
            </section>
          )}
        </div>
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
        <h2>
          {view.status === "lobby" ? "参加者を招待" : "新規受付は終了しました"}
        </h2>
      </div>
      <QrCode url={joinUrl} />
      <b className="join-code-label">{view.id}</b>
      <p>
        {view.status === "lobby" ? (
          <>
            QRを読むか、トップページで
            <br />
            この参加コードを入力してください。
          </>
        ) : (
          <>
            参加済みの方は、同じブラウザで
            <br />
            カードに戻れます。
          </>
        )}
      </p>
      <button
        className="button outline wide small"
        onClick={() => copy(joinUrl)}
      >
        参加URLをコピー
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
  const burst = useCelebration(
    view.gameNumber,
    me && cardStatus(me.card, view.drawn).bingo ? 1 : 0,
  );
  if (!me)
    return (
      <main id="main-content" className="participant-entry">
        <div className="entry-bingo" aria-hidden="true">
          {"BINGO".split("").map((letter) => (
            <b key={letter}>{letter}</b>
          ))}
        </div>
        <p className="section-label">ビンゴに参加</p>
        <h1>{view.title}</h1>
        <p>
          ニックネームを入力してください。
          <br />
          参加すると、この画面にカードが表示されます。
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
  const prize = view.prizes.find((item) => item.playerId === me.id);
  const latest = view.drawn.at(-1);
  return (
    <main
      id="main-content"
      className={`participant-main ${status.bingo ? "has-bingo" : ""}`}
    >
      <Celebration burst={burst} />
      <div className="participant-greeting">
        <h1>
          {me.name}
          <small>さんのカード</small>
        </h1>
        <span>第{view.gameNumber}ゲーム</span>
      </div>
      <div className="participant-latest">
        <div>
          <span>
            {view.status === "finished"
              ? "最後に出た番号"
              : latest
                ? "いま出た番号"
                : "まもなくスタート"}
          </span>
          <p>
            {latest
              ? `${view.drawn.length} / 75 回目`
              : "カードを開いてお待ちください。"}
          </p>
        </div>
        {latest ? (
          <DrawBall number={latest} />
        ) : (
          <span className="waiting-balls" aria-hidden="true">
            <i>B</i>
            <i>I</i>
            <i>N</i>
            <i>G</i>
            <i>O</i>
          </span>
        )}
      </div>
      <div
        className={`card-status ${status.bingo ? "bingo-status" : status.reach ? "reach-status" : ""}`}
        role="status"
      >
        {view.status === "finished" ? (
          <>
            <b>このゲームは終了しました。</b>
            {status.bingo && <span>{me.rank}位でビンゴ！</span>}
          </>
        ) : status.bingo ? (
          <>
            <b>ビンゴ！</b>
            <span>{me.rank}位 おめでとう！</span>
          </>
        ) : status.reach ? (
          <>
            <b>リーチ！ あと1つ</b>
            <span>{status.needed.join("・")}番でビンゴ</span>
          </>
        ) : latest ? (
          <>
            <span>自動で開きます</span>
            <b>縦・横・斜め、1列そろえばビンゴ！</b>
          </>
        ) : (
          <>
            <span>カードの準備OK</span>
            <b>幹事が番号をひくと、自動で開きます。</b>
          </>
        )}
      </div>
      <BingoCard card={me.card} drawn={view.drawn} />
      {prize ? (
        <div className="won-prize">
          <span>あなたの景品</span>
          <h2>{prize.name}</h2>
          <p>幹事に名前を伝えて、景品を受け取ってください。</p>
        </div>
      ) : (
        <p className="participant-help">
          {status.bingo
            ? "幹事にもビンゴが届いています。景品の案内をお待ちください。"
            : "リーチもビンゴも自動判定。申告の操作は不要です。"}
        </p>
      )}
      <details className="drawn-details">
        <summary>
          これまでに出た番号を見る <span>{view.drawn.length}個</span>
        </summary>
        <NumberBoard drawn={view.drawn} />
      </details>
      {playerKey && (
        <details className="card-recovery">
          <summary>このカードを保存・別の端末で開く</summary>
          <p>
            復帰リンクを保存すると、別の端末でも同じカードに戻れます。他の人には共有しないでください。
          </p>
          <button
            className="button wide"
            onClick={() =>
              copy(`${location.origin}/join/${view.id}#card=${playerKey}`)
            }
          >
            このカードの復帰リンクをコピー
          </button>
        </details>
      )}
    </main>
  );
}

function Screen({
  view,
  joinUrl,
  connected,
}: {
  view: RoomView;
  joinUrl: string;
  connected: boolean;
}) {
  const [canFullscreen, setCanFullscreen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const burst = useCelebration(view.gameNumber, view.winners.length);
  useEffect(() => {
    setCanFullscreen(Boolean(document.fullscreenEnabled));
    const changed = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  const newest = view.winners.filter(
    (player) => player.bingoAt === view.drawn.length,
  );
  const shown = newest.length ? newest.slice(0, 6) : view.winners.slice(-6);
  const lobby = view.status === "lobby";
  return (
    <main
      id="main-content"
      className={`screen-main ${lobby ? "screen-lobby" : ""}`}
    >
      <Celebration burst={burst} />
      <header className="screen-title">
        <div>
          <span className="screen-brand" aria-hidden="true">
            BINGO ROOM
          </span>
          <h1>{view.title}</h1>
        </div>
        <div className="screen-controls">
          <Connection connected={connected} />
          {!lobby && (
            <details className="screen-return">
              <summary>カードに戻る</summary>
              <div>
                <QrCode url={joinUrl} />
                <b>{view.id}</b>
                <p>参加したときと同じブラウザで開いてください。</p>
              </div>
            </details>
          )}
          {canFullscreen && (
            <button
              className="screen-fullscreen"
              onClick={() => {
                const task = document.fullscreenElement
                  ? document.exitFullscreen()
                  : document.documentElement.requestFullscreen();
                task.catch(() =>
                  window.alert(
                    "全画面に切り替えられませんでした。ブラウザの全画面機能をお使いください。",
                  ),
                );
              }}
            >
              {fullscreen ? "全画面を終了" : "全画面表示"}
            </button>
          )}
        </div>
      </header>
      {lobby ? (
        <div className="screen-waiting">
          <div className="screen-welcome">
            <div className="welcome-letters" aria-hidden="true">
              {"BINGO".split("").map((letter) => (
                <b key={letter}>{letter}</b>
              ))}
            </div>
            <h2>
              まずは、カードを
              <br />
              受け取ってください。
            </h2>
            <p>QRを読み取って、ニックネームを入力。</p>
            <p className="screen-count">
              <strong>{view.count}</strong>人が参加済み
            </p>
            <span>みんながそろったら、スタート！</span>
          </div>
          <aside className="screen-join">
            <span className="screen-join-heading">スマホでQRを読み取る</span>
            <QrCode url={joinUrl} />
            <span className="screen-code-caption">参加コード</span>
            <b>{view.id}</b>
            <span>
              コードの入力先
              <br />
              <b className="screen-address">{joinUrl.split("/join/")[0]}</b>
            </span>
          </aside>
        </div>
      ) : (
        <>
          <div className="screen-stage">
            <section className="screen-draw">
              <span className="screen-call-label">
                {view.status === "finished"
                  ? "ゲーム終了"
                  : `第${view.drawn.length}回の番号`}
              </span>
              <DrawBall number={view.drawn.at(-1)} />
              <div className="screen-recent">
                {view.drawn.length > 1 && <span>ひとつ前</span>}
                {view.drawn
                  .slice(-5, -1)
                  .reverse()
                  .map((number) => (
                    <b key={number}>{number}</b>
                  ))}
              </div>
            </section>
            <div className="screen-board">
              <div>
                <h2>これまでに出た番号</h2>
                <span>{view.drawn.length} / 75</span>
              </div>
              <NumberBoard drawn={view.drawn} />
            </div>
          </div>
          <section
            className={`screen-winners ${newest.length ? "has-new-winners" : ""}`}
            aria-label="直近の当選者"
          >
            <div className="screen-winners-title">
              <span aria-hidden="true">
                {view.winners.length ? "BINGO!" : "BINGO"}
              </span>
              <h2>
                {newest.length
                  ? `この番号で ${newest.length}人がビンゴ`
                  : shown.length
                    ? "直近のビンゴ"
                    : "次のビンゴは、だれ？"}
              </h2>
              <b>合計 {view.winners.length}人</b>
            </div>
            {shown.length ? (
              <div className="screen-winner-names">
                {shown.map((player) => (
                  <p key={player.id}>
                    <b>
                      <em>{player.rank}位</em>
                      {player.name}
                    </b>
                    <span>
                      {
                        view.prizes.find(
                          (prize) => prize.playerId === player.id,
                        )?.name
                      }
                    </span>
                  </p>
                ))}
              </div>
            ) : (
              <p className="screen-winners-empty">
                縦・横・斜めの1列でビンゴ。カードは自動で開きます。
              </p>
            )}
            {newest.length > 6 && (
              <p className="screen-winners-more">
                ほか{newest.length - 6}人。同じ抽選回でのビンゴは同順位です。
              </p>
            )}
          </section>
        </>
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
    <main id="main-content" className="print-page">
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
