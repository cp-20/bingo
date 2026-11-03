"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Card, Prize, RoomView } from "@/lib/game";
import { cardStatus } from "@/lib/card";
import { Arrow, BingoCard, Logo, NumberBoard } from "./ui";

type Role = "host" | "player" | "screen";
function useHostKey(id: string, enabled: boolean) {
  const [key, setKey] = useState<string | null | undefined>(
    enabled ? undefined : null,
  );
  useEffect(() => {
    if (!enabled) return;
    const fromLink = new URLSearchParams(location.hash.slice(1)).get("key");
    if (fromLink && /^[A-Za-z0-9_-]{43}$/.test(fromLink)) {
      try {
        localStorage.setItem(`bingo-host-${id}`, fromLink);
      } catch {
        /* The recovery link still works for this visit. */
      }
      history.replaceState(null, "", location.pathname + location.search);
      setKey(fromLink);
      return;
    }
    try {
      setKey(localStorage.getItem(`bingo-host-${id}`));
    } catch {
      setKey(null);
    }
  }, [id, enabled]);
  return key;
}
function useRoom(id: string, role: Role, key: string | null | undefined) {
  const [view, setView] = useState<RoomView>();
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [generation, setGeneration] = useState(0);
  const refresh = useCallback(() => setGeneration((n) => n + 1), []);
  useEffect(() => {
    if (role === "host" && !key) return;
    let stopped = false;
    let revision: number | undefined;
    let timer: ReturnType<typeof setTimeout>;
    let current: AbortController | undefined;
    let inFlight = false;
    let failures = 0;
    async function poll() {
      if (inFlight || stopped) return;
      inFlight = true;
      current = new AbortController();
      const timeout = setTimeout(() => current?.abort(), 10000);
      let terminal = false;
      try {
        const res = await fetch(
          `/api/rooms/${id}${revision ? `?revision=${revision}` : ""}`,
          {
            headers: key ? { Authorization: `Bearer ${key}` } : {},
            cache: "no-store",
            signal: current.signal,
          },
        );
        if (stopped) return;
        if (res.status !== 304) {
          const data = await res.json();
          if (!res.ok) {
            terminal = [401, 404, 410].includes(res.status);
            throw new Error(data.error || "接続を確認しています。");
          }
          revision = data.revision;
          setView(data);
        }
        setError("");
        setConnected(true);
        failures = 0;
      } catch (error) {
        if (!stopped) {
          failures++;
          setConnected(false);
          setError(
            error instanceof Error && error.name !== "AbortError"
              ? error.message
              : "接続を確認しています。画面を閉じずにお待ちください。",
          );
        }
      } finally {
        clearTimeout(timeout);
        inFlight = false;
        if (!stopped && !terminal)
          timer = setTimeout(
            poll,
            Math.min(15000, 4000 * Math.max(1, failures)) +
              Math.random() * 1500,
          );
      }
    }
    void poll();
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        clearTimeout(timer);
        void poll();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      current?.abort();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [id, key, role, generation]);
  return { view, error, connected, refresh };
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
  const key = useHostKey(id, role === "host");
  const { view, error, connected, refresh } = useRoom(id, role, key);
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
  if (!view)
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
      {role === "host" ? (
        <Host
          view={view}
          hostKey={key!}
          refresh={refresh}
          joinUrl={joinUrl}
          copy={copy}
        />
      ) : role === "screen" ? (
        <Screen view={view} joinUrl={joinUrl} />
      ) : (
        <Participant view={view} refresh={refresh} />
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
}: {
  view: RoomView;
  hostKey: string;
  refresh: () => void;
  joinUrl: string;
  copy: (text: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [prizeName, setPrizeName] = useState("");
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
    if (busy) return false;
    setBusy(true);
    setError("");
    if (input.action === "draw") setRolling(true);
    try {
      const res = await fetch(`/api/rooms/${view.id}/action`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${hostKey}`,
        },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      refresh();
      return true;
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "操作できませんでした。",
      );
      refresh();
      return false;
    } finally {
      setBusy(false);
      setRolling(false);
    }
  }
  async function upgrade() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/rooms/${view.id}/checkout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${hostKey}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const url = new URL(data.url);
      if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com")
        throw new Error("決済画面を開けませんでした。");
      location.assign(url.href);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "決済を開始できませんでした。",
      );
      setBusy(false);
    }
  }
  async function downloadCsv() {
    try {
      const res = await fetch(`/api/rooms/${view.id}/export`, {
        headers: { Authorization: `Bearer ${hostKey}` },
      });
      if (!res.ok) throw new Error("結果を保存できませんでした。");
      const url = URL.createObjectURL(await res.blob());
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
          Stripeの決済結果を確認しています。反映まで少しお待ちください。
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
              <button className="text-link" onClick={downloadCsv}>
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
          <section className="panel join-panel">
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
          <section className="panel prizes-panel">
            <div className="panel-heading">
              <h2>景品リスト</h2>
              <span>{view.prizes.length}個</span>
            </div>
            <form
              className="prize-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await action({ action: "prize", name: prizeName }))
                  setPrizeName("");
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
                onChange={(e) => setPrizeName(e.target.value)}
              />
              <button
                className="button primary"
                disabled={busy}
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
                  busy={busy}
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
                disabled={busy || !view.paymentReady}
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
              disabled={busy}
            >
              リハーサル・次のゲームへ ↻
            </button>
            <button
              onClick={() => {
                if (confirm("このゲームを終了します。結果は保存されます。"))
                  void action({ action: "finish" });
              }}
              disabled={busy || view.status === "finished"}
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
            onClick={() =>
              void action({
                action: "award",
                prizeId: prize.id,
                playerId: selected,
              })
            }
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
}: {
  view: RoomView;
  refresh: () => void;
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
              setBusy(true);
              setError("");
              try {
                const res = await fetch(`/api/rooms/${view.id}/join`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ name }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error);
                refresh();
              } catch (error) {
                setError(
                  error instanceof Error
                    ? error.message
                    : "参加できませんでした。",
                );
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
            <button className="button primary wide" disabled={busy}>
              {busy ? "カードを準備しています…" : "ビンゴに参加する"}
              <Arrow />
            </button>
            <small>
              ニックネームは幹事・会場スクリーンに表示されます。
              <br />
              カードに戻るときは、同じ端末・ブラウザで開いてください。
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
        画面が止まったら、同じブラウザで再読み込みしてください。
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
  const key = useHostKey(id, true);
  const [cards, setCards] = useState<
    { id: string; name: string; card: Card }[]
  >([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!key) return;
    let active = true;
    fetch(`/api/rooms/${id}/export?format=cards`, {
      headers: { Authorization: `Bearer ${key}` },
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
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
