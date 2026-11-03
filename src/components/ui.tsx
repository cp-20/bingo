"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, clientSecret } from "@/lib/client";
import type { Card } from "@/lib/game";

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <Link
      href="/"
      className={`logo ${light ? "light" : ""}`}
      aria-label="BINGO ROOM ホーム"
    >
      <span className="logo-mark" aria-hidden="true">B</span>
      <span>
        BINGO<span className="logo-room">ROOM</span>
      </span>
    </Link>
  );
}
export function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <span aria-hidden="true">{diagonal ? "↗" : "→"}</span>;
}
export function BingoCard({
  card,
  drawn = [],
  mini = false,
}: {
  card: Card;
  drawn?: number[];
  mini?: boolean;
}) {
  return (
    <div className={`bingo-card ${mini ? "mini" : ""}`}>
      <div className="card-letters" aria-hidden="true">
        {"BINGO".split("").map((n, i) => (
          <b key={i}>{n}</b>
        ))}
      </div>
      <div className="card-numbers" role="table" aria-label="ビンゴカード">
        {Array.from({ length: 5 }, (_, row) => (
          <div role="row" className="card-row" key={row}>
            {card.slice(row * 5, row * 5 + 5).map((number, col) => (
              <div
                key={col}
                role="cell"
                aria-label={
                  number === 0
                    ? "フリーマス、開いています"
                    : `${number}${drawn.includes(number) ? "、開いています" : "、まだ開いていません"}`
                }
                className={`${number === 0 ? "free" : ""} ${drawn.includes(number) ? "marked" : ""}`}
              >
                {number === 0 ? (
                  <span className="free-symbol">FREE</span>
                ) : (
                  number
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
export function NumberBoard({ drawn }: { drawn: number[] }) {
  return <div className="number-board" role="group" aria-label="抽選番号一覧（1〜75）">
    {["B","I","N","G","O"].map((letter,column)=><div className="number-band" key={letter}>
      <b aria-hidden="true">{letter}</b>
      <div>{Array.from({length:15},(_,i)=>column*15+i+1).map(n=><span key={n} className={(drawn.includes(n)?"hit":"")+(drawn.at(-1)===n?" latest":"")}>{n}<span className="sr-only">{drawn.includes(n)?"、抽選済み":"、未抽選"}</span></span>)}</div>
    </div>)}
  </div>;
}
export function CreateRoom({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState<boolean | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef<{ title: string; key: string } | null>(null);
  async function checkReady() {
    setReady(null);
    try {
      await api("/api/ready");
      setReady(true);
    } catch {
      setReady(false);
    }
  }
  useEffect(() => {
    const element = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    try {
      const value = JSON.parse(
        localStorage.getItem("bingo-pending-create") || "null",
      );
      if (
        value &&
        typeof value.title === "string" &&
        /^[A-Za-z0-9_-]{43}$/.test(value.key)
      ) {
        pending.current = value;
        setTitle(value.title);
      }
    } catch {
      /* Storage may be disabled. The current request remains recoverable in memory. */
    }
    element.showModal();
    element.querySelector<HTMLInputElement>("input")?.focus();
    document.body.style.overflow = "hidden";
    void checkReady();
    return () => {
      element.close();
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="modal"
      aria-labelledby="create-title"
      onClose={onClose}
      onCancel={(e) => {
        if (busy) e.preventDefault();
      }}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        if (
          !busy &&
          e.target === e.currentTarget &&
          (e.clientX < rect.left ||
            e.clientX > rect.right ||
            e.clientY < rect.top ||
            e.clientY > rect.bottom)
        )
          e.currentTarget.close();
      }}
    >
      <button
        className="close-button"
        disabled={busy}
        onClick={() => dialog.current?.close()}
        aria-label="閉じる"
      >
        ×
      </button>
      <h2 id="create-title">イベントをつくる</h2>
      <p className="muted">
        イベント名を入力してください。
        <br />
        30人まで無料、クレジットカードも不要です。
      </p>
      {ready === false && (
        <div className="notice" role="alert">
          ただいまイベントの作成を一時停止しています。入力内容はこの画面に残るので、少し待ってからお試しください。
          <button onClick={checkReady}>接続を再確認</button>
        </div>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || !ready) return;
          setBusy(true);
          setError("");
          try {
            if (!pending.current || pending.current.title !== title)
              pending.current = { title, key: clientSecret() };
            try {
              localStorage.setItem(
                "bingo-pending-create",
                JSON.stringify(pending.current),
              );
            } catch {
              /* A retry in this dialog still uses the same key. */
            }
            const data = await api<{ id: string; hostToken: string }>(
              "/api/rooms",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Idempotency-Key": pending.current.key,
                },
                body: JSON.stringify({ title }),
              },
            );
            try {
              localStorage.removeItem("bingo-pending-create");
            } catch {
              /* The host link is available in the URL. */
            }
            location.assign(`/host/${data.id}#key=${data.hostToken}`);
          } catch (error) {
            setError(
              error instanceof Error
                ? error.message
                : "イベントを作成できませんでした。",
            );
            setBusy(false);
          }
        }}
      >
        <label htmlFor="event-name">イベント名</label>
        <input
          id="event-name"
          autoFocus
          autoComplete="off"
          maxLength={40}
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例：みんなで忘年会 2026"
        />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary wide" disabled={busy || !ready}>
          {busy
            ? "会場を準備しています…"
            : ready === null
              ? "接続を確認しています…"
              : "無料でイベントをつくる"}
          <Arrow />
        </button>
        <p className="fineprint">
          <Link href="/terms" target="_blank">
            利用規約
          </Link>
          ・
          <Link href="/privacy" target="_blank">
            プライバシーポリシー
          </Link>
          に同意して作成します。
        </p>
      </form>
    </dialog>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <Logo />
      
      <nav aria-label="フッター">
        <Link href="/guide">使い方</Link>
        <Link href="/terms">利用規約</Link>
        <Link href="/privacy">プライバシー</Link>
        <Link href="/legal">販売条件</Link>
      </nav>
      <small>© {new Date().getFullYear()} BINGO ROOM</small>
    </footer>
  );
}
