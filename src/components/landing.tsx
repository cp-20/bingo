"use client";
import Link from "next/link";
import { useState } from "react";
import { Arrow, BingoCard, CreateRoom, Footer, Logo } from "./ui";

const demoCard = [
  7, 19, 34, 49, 65, 11, 22, 38, 52, 70, 3, 27, 0, 55, 62, 14, 16, 41, 47, 73,
  9, 24, 43, 58, 68,
];
const initialDraws = [7, 22, 41, 68, 19, 52, 3, 47];

export default function Landing() {
  const [create, setCreate] = useState(false);
  const [drawn, setDrawn] = useState(initialDraws);
  const [rolling, setRolling] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const open = () => setCreate(true);
  function demoDraw() {
    if (rolling) return;
    setRolling(true);
    setTimeout(() => {
      setDrawn((old) => {
        const remaining = Array.from({ length: 75 }, (_, i) => i + 1).filter(
          (n) => !old.includes(n),
        );
        return remaining.length
          ? [...old, remaining[Math.floor(Math.random() * remaining.length)]]
          : initialDraws;
      });
      setRolling(false);
    }, 600);
  }
  return (
    <>
      <div className="announcement">
        ただいまテスト公開中{" "}
        <span>有料プランの決済は sandbox です。実際の請求は発生しません。</span>
      </div>
      <header className="site-header">
        <Logo />
        <nav aria-label="メイン">
          <a href="#features">できること</a>
          <a href="#how">使い方</a>
          <a href="#pricing">料金</a>
        </nav>
        <button onClick={open} className="button header-cta">
          無料ではじめる <Arrow diagonal />
        </button>
      </header>
      <main>
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow">
              <span className="status-dot" /> GOOD PEOPLE. GOOD TIMES.
            </span>
            <h1>
              集まったら、
              <br />
              <span>ビンゴ</span>しよう<span className="hero-period">。</span>
            </h1>
            <p>
              紙もアプリも、準備いらず。
              <br />
              QRコードで、スマホがビンゴカードに。
              <br />
              幹事もいっしょに楽しもう。
            </p>
            <div className="hero-buttons">
              <button className="button primary large" onClick={open}>
                無料でイベントをつくる <Arrow diagonal />
              </button>
              <a href="#demo" className="demo-link" onClick={demoDraw}>
                <span className="play-icon">▶</span> まずは触ってみる
              </a>
            </div>
            <div className="hero-checks">
              <span>✓ 30人まで無料</span>
              <span>✓ 参加者の登録不要</span>
              <span>✓ アプリ不要</span>
            </div>
          </div>
          <div className="hero-art" id="demo">
            <div className="art-orbit orbit-one" />
            <div className="art-orbit orbit-two" />
            <span className="art-caption">ONE ROOM, EVERYONE’S IN.</span>
            <div className="floating-ball ball-yellow">
              B<span>07</span>
            </div>
            <div className="floating-ball ball-white">
              O<span>68</span>
            </div>
            <div className="live-demo">
              <div className="demo-top">
                <span>
                  <i /> LIVE DEMO
                </span>
                <span>タップして体験 ↙</span>
              </div>
              <div className="demo-title">
                FRIDAY NIGHT BINGO<span>今夜はみんなで、いい時間。</span>
              </div>
              <div className={`demo-draw ${rolling ? "rolling" : ""}`}>
                <span>{rolling ? "…" : drawn.at(-1)}</span>
                <small>NOW DRAWING</small>
              </div>
              <div className="demo-history">
                {drawn
                  .slice(-5)
                  .reverse()
                  .map((n, i) => (
                    <span key={`${n}-${i}`}>{n}</span>
                  ))}
              </div>
              <button
                onClick={demoDraw}
                className="button demo-button"
                disabled={rolling}
              >
                {rolling ? "ドキドキ…" : "次の番号をひく"}
                <Arrow />
              </button>
            </div>
            <div className="phone-demo">
              <div className="phone-notch" />
              <div className="phone-header">
                <span>YOUR CARD</span>
                <i>● 接続中</i>
              </div>
              <BingoCard card={demoCard} drawn={drawn} mini />
              <span className="phone-note">番号は自動でチェック ✓</span>
            </div>
            <div className="art-sticker">
              みんなのスマホと
              <br />
              つながる！<span>✦</span>
            </div>
            <span className="art-spark spark-one">✳</span>
            <span className="art-spark spark-two">✦</span>
          </div>
        </section>
        <section className="occasion-strip" aria-label="利用シーン">
          <span>あの集まりにも、この集まりにも。</span>
          <b>忘年会・新年会</b>
          <i>✦</i>
          <b>結婚式の二次会</b>
          <i>✦</i>
          <b>社内イベント</b>
          <i>✦</i>
          <b>友だちとのパーティー</b>
        </section>
        <section className="section features" id="features">
          <div className="section-heading">
            <span className="eyebrow">LESS WORK, MORE FUN.</span>
            <h2>
              幹事の「たいへん」を、
              <br />
              みんなの「たのしい」に。
            </h2>
            <p>
              準備はかんたん。当日の進行はスムーズ。
              <br />
              いちばん忙しい人も、ちゃんと楽しめるように。
            </p>
          </div>
          <div className="feature-grid">
            <article className="feature-card">
              <div className="feature-illustration qr-illustration">
                <div className="fake-qr" aria-hidden="true">
                  ▦
                </div>
                <span className="mini-label">JOIN THE ROOM ↗</span>
              </div>
              <span className="feature-number">01 / EASY ENTRY</span>
              <h3>読むだけで、もう参加。</h3>
              <p>
                QRコードか参加コードで入室。参加者の会員登録やアプリのインストールは不要です。
              </p>
            </article>
            <article className="feature-card">
              <div className="feature-illustration sync-illustration">
                <span>24</span>
                <i>→</i>
                <span className="sync-checked">
                  24<small>✓</small>
                </span>
              </div>
              <span className="feature-number">02 / ALL IN SYNC</span>
              <h3>番号も、ビンゴも、自動。</h3>
              <p>
                抽選結果をみんなのカードに反映。ビンゴと同着を自動判定するので、確認に追われません。
              </p>
            </article>
            <article className="feature-card">
              <div className="feature-illustration prize-illustration">
                <span>✦</span>
                <b>1st</b>
                <span>✧</span>
              </div>
              <span className="feature-number">03 / RUN IT SMOOTHLY</span>
              <h3>景品まで、ひとつの画面。</h3>
              <p>
                当選者と景品をまとめて管理。リハーサル、カード印刷、結果のCSV保存にも対応します。
              </p>
            </article>
          </div>
        </section>
        <section className="how-section" id="how">
          <div className="section-heading">
            <span className="eyebrow">READY IN THREE STEPS</span>
            <h2>
              はじまるまで、
              <br />
              たったの3ステップ。
            </h2>
            <Link href="/guide" className="text-link">
              詳しい使い方を見る <Arrow />
            </Link>
          </div>
          <div className="steps">
            <article>
              <span>01</span>
              <div>
                <h3>会場をつくる</h3>
                <p>
                  イベント名を入力するだけ。
                  <br />
                  景品の登録も、ここでできます。
                </p>
              </div>
              <i>↗</i>
            </article>
            <article>
              <span>02</span>
              <div>
                <h3>QRコードをみんなにシェア</h3>
                <p>
                  会場のスクリーンに表示したり、
                  <br />
                  URLを事前に送ったり。集まり方は自由。
                </p>
              </div>
              <i>↗</i>
            </article>
            <article>
              <span>03</span>
              <div>
                <h3>あとは、ボタンを押すだけ</h3>
                <p>
                  抽選も、カードのチェックも、ビンゴ判定も。
                  <br />
                  みんなと同じドキドキを楽しみましょう。
                </p>
              </div>
              <i>✦</i>
            </article>
          </div>
        </section>
        <section className="section pricing" id="pricing">
          <div className="section-heading centered">
            <span className="eyebrow">SIMPLE & FAIR</span>
            <h2>
              ちいさな集まりも、
              <br />
              大きなパーティーも。
            </h2>
            <p>
              まずは無料で、ひと通り体験。大人数の本番も、わかりやすい料金で。
            </p>
          </div>
          <div className="pricing-grid">
            <article className="price-card">
              <span className="eyebrow">FREE ROOM</span>
              <h3>まずは、気軽に。</h3>
              <div className="price">
                ¥0<span>ずっと無料</span>
              </div>
              <p>友だちとの集まりや、本番前のお試しに。</p>
              <ul>
                <li>最大30人まで参加</li>
                <li>QR参加・カード自動チェック</li>
                <li>会場スクリーン・景品管理</li>
                <li>リハーサル・カード印刷・結果CSV</li>
                <li>イベント作成から7日間利用可能</li>
              </ul>
              <button className="button outline wide" onClick={open}>
                無料ではじめる <Arrow />
              </button>
            </article>
            <article className="price-card featured">
              <span className="price-tag">大人数のイベントに</span>
              <span className="eyebrow">EVENT ROOM</span>
              <h3>みんなで、思いきり。</h3>
              <div className="price">
                ¥2,980<span>税込 / 1イベント</span>
              </div>
              <p>会社の忘年会や、結婚式の二次会に。</p>
              <ul>
                <li>
                  <strong>最大300人まで参加</strong>
                </li>
                <li>無料プランのすべての機能</li>
                <li>
                  <strong>決済確認から30日間利用可能</strong>
                </li>
                <li>期間内のリハーサル・再ゲームOK</li>
                <li>自動更新・月額料金なし</li>
              </ul>
              <button className="button primary wide" onClick={open}>
                無料で試してから決める <Arrow />
              </button>
              <small className="price-note">
                現在はテスト決済のみ。実際の請求はありません。
              </small>
            </article>
          </div>
        </section>
        <section className="join-section">
          <div>
            <span className="eyebrow">INVITED TO A ROOM?</span>
            <h2>参加する方はこちら。</h2>
            <p>幹事から届いた8文字の参加コードを入力してください。</p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              location.assign(
                `/join/${joinCode.toUpperCase().replaceAll(" ", "")}`,
              );
            }}
          >
            <label htmlFor="join-code" className="sr-only">
              参加コード
            </label>
            <input
              id="join-code"
              placeholder="ABCD2345"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              maxLength={8}
              minLength={8}
              pattern="[A-Za-z2-9]{8}"
              autoComplete="off"
              required
            />
            <button className="button primary" type="submit">
              参加する <Arrow />
            </button>
          </form>
        </section>
        <section className="closing">
          <span className="eyebrow">MAKE A LITTLE GOOD TIME.</span>
          <h2>
            次の「ビンゴ！」を、
            <br />
            みんなで。
          </h2>
          <button className="button light-button large" onClick={open}>
            無料でイベントをつくる <Arrow diagonal />
          </button>
          <span className="closing-star">✳</span>
        </section>
      </main>
      <Footer />
      {create && <CreateRoom onClose={() => setCreate(false)} />}
    </>
  );
}
