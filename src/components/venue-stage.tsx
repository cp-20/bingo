"use client";
import { useEffect, useRef, useState } from "react";
import type { CommunityFeed, RoomView } from "@/lib/game";
import { DrawBall, NumberBoard } from "./ui";
import { Celebration, useCelebration } from "./celebration";
import { PrizePicture } from "./prizes";
import { Connection, QrCode } from "./room";

function useStageSound(view: RoomView) {
  const audio = useRef<AudioContext | null>(null);
  const [enabled, setEnabled] = useState(false),
    previous = useRef({ game: view.gameNumber, draw: view.drawn.length });
  function tone(
    context: AudioContext,
    frequency: number,
    start: number,
    duration: number,
    volume = 0.08,
  ) {
    const oscillator = context.createOscillator(),
      gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration);
  }
  useEffect(() => {
    const before = previous.current;
    previous.current = { game: view.gameNumber, draw: view.drawn.length };
    const context = audio.current;
    if (
      !enabled ||
      !context ||
      before.game !== view.gameNumber ||
      before.draw >= view.drawn.length
    )
      return;
    const bingo = view.winners.some((w) => w.bingoAt === view.drawn.length),
      notes = bingo ? [523.25, 659.25, 783.99, 1046.5] : [440, 660];
    notes.forEach((frequency, i) =>
      tone(
        context,
        frequency,
        context.currentTime + i * 0.12,
        bingo ? 0.5 : 0.16,
      ),
    );
  }, [enabled, view.gameNumber, view.drawn.length, view.winners]);
  useEffect(
    () => () => {
      void audio.current?.close();
    },
    [],
  );
  async function toggle() {
    if (enabled) {
      setEnabled(false);
      return;
    }
    try {
      audio.current ??= new AudioContext();
      await audio.current.resume();
      tone(audio.current, 523.25, audio.current.currentTime, 0.15, 0.035);
      setEnabled(true);
    } catch {
      setEnabled(false);
    }
  }
  return { enabled, toggle };
}
export default function VenueStage({
  view,
  live,
  joinUrl,
  connected,
}: {
  view: RoomView;
  live?: CommunityFeed;
  joinUrl: string;
  connected: boolean;
}) {
  const [fullscreen, setFullscreen] = useState(false),
    [canFullscreen, setCanFullscreen] = useState(false);
  const sound = useStageSound(view);
  useEffect(() => {
    setCanFullscreen(Boolean(document.fullscreenEnabled));
    const changed = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  const newest = view.winners.filter((p) => p.bingoAt === view.drawn.length),
    burst = useCelebration(
      view.gameNumber,
      view.winners.length,
      view.drawn.length,
    );
  const stagePrize = view.prizes.find((p) => p.id === view.stage?.prizeId),
    featured =
      view.prizes.find((p) => p.id === view.featuredPrizeId && !p.playerId) ||
      view.prizes.find((p) => !p.playerId);
  const mode =
    view.stage?.mode ||
    (view.status === "lobby"
      ? "welcome"
      : view.status === "finished"
        ? "closing"
        : newest.length
          ? "bingo"
          : "draw");
  const shown = newest.slice(0, 4),
    recent = view.drawn.slice(-5, -1).reverse();
  return (
    <main id="main-content" className={`venue scene-${mode}`}>
      <div className="venue-lights" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <Celebration burst={burst} />
      <header className="venue-header">
        <h1>{view.title}</h1>
        <span className="venue-game">第{view.gameNumber}ゲーム</span>
        <div className="venue-controls">
          <Connection connected={connected} />
          <button
            onClick={() => void sound.toggle()}
            aria-pressed={sound.enabled}
          >
            {sound.enabled ? "音あり ♪" : "音をつける ♪"}
          </button>
          {canFullscreen && (
            <button
              onClick={() => {
                void (
                  document.fullscreenElement
                    ? document.exitFullscreen()
                    : document.documentElement.requestFullscreen()
                ).catch(() =>
                  window.alert("ブラウザの全画面機能をお使いください。"),
                );
              }}
            >
              {fullscreen ? "全画面を終了" : "全画面表示"}
            </button>
          )}
        </div>
      </header>
      <div
        className="venue-content"
        key={`${mode}:${view.gameNumber}:${view.drawn.length}:${stagePrize?.id || ""}`}
      >
        {mode === "welcome" ? (
          <section className="venue-welcome">
            <div>
              <p className="show-eyebrow">今夜の主役は、あなたかも。</p>
              <div className="show-bingo" role="img" aria-label="ビンゴ">
                {"BINGO".split("").map((c) => (
                  <span aria-hidden="true" key={c}>
                    {c}
                  </span>
                ))}
              </div>
              <h2>
                スマホをカードに。
                <br />
                みんなで、運だめし！
              </h2>
              <p className="welcome-count">
                <b>{view.count}</b>人がスタンバイ
              </p>
              {view.prizes.length > 0 && (
                <div className="welcome-prizes">
                  {view.prizes
                    .filter((p) => !p.playerId)
                    .slice(0, 3)
                    .map((prize) => (
                      <div key={prize.id}>
                        <PrizePicture roomId={view.id} prize={prize} />
                        <b>{prize.name}</b>
                      </div>
                    ))}
                </div>
              )}
            </div>
            <aside className="venue-qr">
              <p>① QRを読む　② 名前を入力</p>
              <QrCode url={joinUrl} />
              <strong>{view.id}</strong>
              <span>トップページからは参加コードで</span>
              <small>{joinUrl.split("/join/")[0]}</small>
            </aside>
          </section>
        ) : mode === "prize" && stagePrize ? (
          <section className="show-prize">
            <div className="show-photo">
              <PrizePicture roomId={view.id} prize={stagePrize} />
              <span className="prize-sticker">
                ねらうは
                <br />
                <b>コレ！</b>
              </span>
            </div>
            <div>
              <p className="show-eyebrow">本日の景品 · ただいま紹介中</p>
              <h2>{stagePrize.name}</h2>
              <p className="prize-crowd-call">ほしい人、手をあげて！</p>
              <p className="show-phone-hint">
                スマホから「✨ ほしい！」を送ろう
              </p>
              {view.status === "lobby" ? (
                <p className="show-prize-wait">まもなく抽選スタート</p>
              ) : (
                <div className="show-latest-small">
                  <span>いま出ている番号</span>
                  <DrawBall number={view.drawn.at(-1)} />
                </div>
              )}
            </div>
          </section>
        ) : mode === "award" && stagePrize ? (
          <section className="show-award">
            <div className="award-spotlight">
              <p className="show-eyebrow">景品の当選者が決まりました</p>
              <span className="award-cheer" aria-hidden="true">
                CONGRATS!
              </span>
              <h2>
                {stagePrize.awardedName ||
                  view.winners.find((p) => p.id === stagePrize.playerId)?.name}
                <small>さん、おめでとう！</small>
              </h2>
              <p>受け取り番号をスマホで確認して、景品係へ。</p>
            </div>
            <div className="award-gift">
              <PrizePicture roomId={view.id} prize={stagePrize} />
              <h3>{stagePrize.name}</h3>
            </div>
          </section>
        ) : mode === "history" ? (
          <section className="show-history">
            <header>
              <h2>これまでに出た番号</h2>
              <p>{view.drawn.length} / 75 回</p>
              <DrawBall number={view.drawn.at(-1)} />
            </header>
            <NumberBoard drawn={view.drawn} />
          </section>
        ) : mode === "closing" ? (
          <section className="show-closing">
            <span className="show-eyebrow">第{view.gameNumber}ゲーム 終了</span>
            <h2>
              たくさんの拍手を、
              <br />
              ありがとう！
            </h2>
            <p>
              <b>{view.winners.length}</b>人がビンゴ！
            </p>
            <div>
              {view.winners.slice(0, 6).map((p) => (
                <span key={p.id}>
                  {p.name}
                  <small>さん</small>
                </span>
              ))}
            </div>
            <p className="closing-hint">
              景品が当たった方は、スマホの受け取り番号を景品係へ。
            </p>
          </section>
        ) : mode === "bingo" ? (
          <section className="show-winners">
            <div className="winner-marquee">
              <span className="show-bingo-word">BINGO!</span>
              <h2>
                この番号で <b>{newest.length}人</b> がビンゴ！
              </h2>
            </div>
            <div className={`winner-spotlights count-${shown.length}`}>
              {shown.map((p) => (
                <div key={p.id}>
                  <span>
                    {p.rank}位
                    {newest.filter((w) => w.rank === p.rank).length > 1
                      ? "・同着"
                      : ""}
                  </span>
                  <strong>
                    {p.name}
                    <small>さん</small>
                  </strong>
                </div>
              ))}
            </div>
            <p className="tie-note">
              {newest.length > 4 ? `ほか${newest.length - 4}人。` : ""}
              同じ番号でのビンゴは同順位です。みんなに拍手！
            </p>
            <div className="show-latest-small bingo-called">
              <span>ビンゴを呼んだ番号</span>
              <DrawBall number={view.drawn.at(-1)} />
            </div>
          </section>
        ) : (
          <section className="show-draw">
            <div className="number-spotlight">
              <p className="show-eyebrow">
                第{view.drawn.length}回 · いま出た番号
              </p>
              <DrawBall number={view.drawn.at(-1)} />
              <div className="show-recent">
                <span>ひとつ前</span>
                {recent.map((n) => (
                  <b key={n}>{n}</b>
                ))}
              </div>
            </div>
            <aside className="draw-story">
              {featured ? (
                <>
                  <p className="show-eyebrow">紹介中の景品</p>
                  <PrizePicture roomId={view.id} prize={featured} />
                  <h2>{featured.name}</h2>
                </>
              ) : (
                <>
                  <div className="draw-story-star" aria-hidden="true">
                    ✦
                  </div>
                  <h2>
                    次のビンゴは、
                    <br />
                    だれだ？
                  </h2>
                </>
              )}
              <div
                className={`reach-crowd ${view.reachCount ? "has-reach" : ""}`}
              >
                <span>
                  {view.reachCount
                    ? "リーチが増えてきた！"
                    : "いっしょに運だめし"}
                </span>
                <p>
                  <b>{view.reachCount || 0}</b>人がリーチ <i>／</i>{" "}
                  <strong>{view.winners.length}</strong>人がビンゴ
                </p>
              </div>
            </aside>
          </section>
        )}
      </div>
      <footer className="venue-footer">
        <div className="screen-comment">
          {live?.pinned ? (
            <>
              <span>{live.pinned.host ? "司会から" : "みんなの声"}</span>
              <p>{live.pinned.body}</p>
              <small>{live.pinned.name}</small>
            </>
          ) : (
            <p>
              {mode === "welcome"
                ? "カードを受け取って、景品をチェック。"
                : "リーチもビンゴも自動判定。スマホから会場へ拍手を送ろう！"}
            </p>
          )}
        </div>
        <div className="screen-reactions" aria-label="会場のリアクション">
          {[
            { k: "clap", i: "👏", l: "拍手" },
            { k: "cheer", i: "🙌", l: "応援" },
            { k: "wow", i: "✨", l: "ほしい" },
          ].map((c) => (
            <span
              role="img"
              key={c.k}
              aria-label={`${c.l} ${live?.reactions[c.k as keyof CommunityFeed["reactions"]] || 0}人`}
            >
              <i aria-hidden="true">{c.i}</i>
              <b
                key={
                  live?.reactions[c.k as keyof CommunityFeed["reactions"]] || 0
                }
              >
                {live?.reactions[c.k as keyof CommunityFeed["reactions"]] || 0}
              </b>
            </span>
          ))}
        </div>
      </footer>
    </main>
  );
}
