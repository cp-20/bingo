"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Card } from "@/lib/game";

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <Link
      href="/"
      className={`logo ${light ? "light" : ""}`}
      aria-label="BINGO ROOM ホーム"
    >
      <span className="logo-mark">
        <i />
        <i />
        <i />
        <i />
      </span>
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
      <div className="card-numbers" role="grid" aria-label="ビンゴカード">
        {card.map((number, index) => (
          <div
            key={index}
            role="gridcell"
            aria-label={
              number === 0
                ? "フリーマス"
                : `${number}${drawn.includes(number) ? "、開いています" : ""}`
            }
            className={`${number === 0 ? "free" : ""} ${drawn.includes(number) ? "marked" : ""}`}
          >
            {number === 0 ? (
              <span className="free-symbol">
                ✦<small>FREE</small>
              </span>
            ) : (
              number
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
export function NumberBoard({ drawn }: { drawn: number[] }) {
  return (
    <div className="number-board" aria-label="抽選済み番号">
      {Array.from({ length: 75 }, (_, i) => i + 1).map((n) => (
        <span
          key={n}
          className={`${drawn.includes(n) ? "hit" : ""} ${drawn.at(-1) === n ? "latest" : ""}`}
        >
          {n}
        </span>
      ))}
    </div>
  );
}
export function CreateRoom({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Tab") {
            const items = e.currentTarget.querySelectorAll<HTMLElement>(
              "button:not(:disabled), input, a[href]",
            );
            const first = items[0],
              last = items[items.length - 1];
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <button className="close-button" onClick={onClose} aria-label="閉じる">
          ×
        </button>
        <span className="eyebrow">LET’S GET TOGETHER</span>
        <h2 id="create-title">今日は、なんの集まり？</h2>
        <p className="muted">
          名前をつけたら、会場のできあがり。
          <br />
          30人まで無料、クレジットカードも不要です。
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const res = await fetch("/api/rooms", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title }),
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data.error);
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
          <button className="button primary wide" disabled={busy}>
            {busy ? "会場を準備しています…" : "無料でイベントをつくる"}
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
      </section>
    </div>
  );
}
export function Footer() {
  return (
    <footer className="footer">
      <Logo />
      <span className="footer-tagline">いい時間に、いいビンゴを。</span>
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
