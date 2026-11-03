"use client";
import Link from "next/link";
import { useState } from "react";
import { BingoCard, CreateRoom, DrawBall, Footer, Logo } from "./ui";

const sampleCard = [
  7, 19, 34, 49, 65, 11, 22, 38, 52, 70, 3, 27, 0, 55, 62, 14, 16, 41, 47, 73,
  9, 24, 43, 58, 68,
];
export default function Landing() {
  const [create, setCreate] = useState(false);
  const [drawn, setDrawn] = useState([7, 22, 41, 68, 19, 52, 3, 47]);
  const [code, setCode] = useState("");
  const [joinError, setJoinError] = useState("");
  function sampleDraw() {
    const remaining = Array.from({ length: 75 }, (_, i) => i + 1).filter(
      (n) => !drawn.includes(n),
    );
    if (remaining.length)
      setDrawn([
        ...drawn,
        remaining[Math.floor(Math.random() * remaining.length)],
      ]);
    else setDrawn([]);
  }
  return (
    <>
      <div className="announcement">
        テスト公開中。有料プランはテスト決済のみで、実際の請求はありません。
      </div>
      <header className="site-header">
        <Logo />
        <nav aria-label="メイン">
          <a href="#join">参加コードで入る</a>
          <a href="#how">使い方</a>
          <a href="#pricing">料金</a>
        </nav>
        <button
          className="button primary header-cta"
          onClick={() => setCreate(true)}
        >
          無料ではじめる
        </button>
      </header>
      <main id="main-content" className="landing-main">
        <div className="join-entry" id="join">
          <div>
            <strong>参加する方</strong>
            <p>幹事から受け取った8文字のコードを入力。</p>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!/^[A-Z2-9]{8}$/.test(code)) {
                setJoinError("参加コードは英数字8文字です。");
                return;
              }
              location.assign("/join/" + code);
            }}
          >
            <label className="sr-only" htmlFor="join-code">
              参加コード
            </label>
            <input
              id="join-code"
              value={code}
              onChange={(event) => {
                setCode(
                  event.target.value
                    .normalize("NFKC")
                    .replace(/\s/g, "")
                    .toUpperCase(),
                );
                setJoinError("");
              }}
              maxLength={32}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              placeholder="参加コード 8文字"
              aria-describedby={joinError ? "join-error" : undefined}
              required
            />
            <button className="button">参加する</button>
            {joinError && (
              <p id="join-error" className="error" role="alert">
                {joinError}
              </p>
            )}
          </form>
        </div>
        <section className="hero">
          <div className="hero-copy">
            <p className="section-label">幹事のためのオンラインビンゴ</p>
            <h1>
              ビンゴの準備は、
              <br />
              会場をつくるだけ。
            </h1>
            <p className="hero-description">
              参加者はQRからカードを受け取り、
              <br />
              幹事は番号をひく。
              <br />
              紙を配らず、そのまま始められます。
            </p>
            <button
              className="button primary large"
              onClick={() => setCreate(true)}
            >
              無料でイベントをつくる
            </button>
            <p className="hero-note">
              30人まで無料 · 会員登録・カードの購入は不要
            </p>
            <p className="hero-price">
              31〜300人は <strong>2,980円</strong>
              <span>／1イベント・税込</span>
            </p>
          </div>
          <section className="landing-sample" aria-label="ビンゴの操作サンプル">
            <div className="sample-heading">
              <h2>抽選の操作サンプル</h2>
              <span>試しに番号をひけます</span>
            </div>
            <div className="sample-body">
              <div className="sample-caller">
                <span>いま出た番号</span>
                <DrawBall number={drawn.at(-1)} />
                <button className="button draw-button" onClick={sampleDraw}>
                  サンプルの番号をひく
                </button>
              </div>
              <BingoCard card={sampleCard} drawn={drawn} mini />
            </div>
            <p className="sample-caption">
              出た数字はカードに自動反映。縦・横・斜めの1列でビンゴです。
            </p>
          </section>
        </section>
        <section id="how" className="how-section">
          <div className="section-heading">
            <h2>当日は、3つの画面で進行。</h2>
            <p>会場の準備から結果の保存まで、幹事の画面から操作できます。</p>
          </div>
          <ol className="event-flow">
            <li>
              <span>1</span>
              <div>
                <h3>会場をつくる</h3>
                <p>
                  イベント名を入力し、幹事用リンクを保存。景品も先に登録できます。
                </p>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <h3>QRを参加者に見せる</h3>
                <p>
                  会場スクリーンのQRから参加。ニックネームを入れると、各自のカードが届きます。
                </p>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <h3>番号をひいて進める</h3>
                <p>
                  カードは自動で開き、リーチ・ビンゴを判定。同じ番号でそろった人は同じ順位です。
                </p>
              </div>
            </li>
          </ol>
          <dl className="event-notes">
            <div>
              <dt>会場スクリーン</dt>
              <dd>プロジェクターに番号と抽選済み一覧を大きく表示。</dd>
            </div>
            <div>
              <dt>景品と結果</dt>
              <dd>当選者へ景品を割り当て、終了後はCSVで保存。</dd>
            </div>
            <div>
              <dt>もしもの備え</dt>
              <dd>
                参加済みカードを印刷可能。通信にはインターネット接続が必要です。
              </dd>
            </div>
          </dl>
          <Link href="/guide" className="text-link">
            事前準備と当日の使い方を読む
          </Link>
        </section>
        <section id="pricing" className="pricing-section">
          <div className="section-heading">
            <h2>人数で選ぶ、2つのプラン。</h2>
            <p>参加者の支払いはありません。月額の自動更新もありません。</p>
          </div>
          <div className="pricing-table-wrap">
            <table className="pricing-table">
              <caption className="sr-only">イベントの料金と人数上限</caption>
              <thead>
                <tr>
                  <th scope="col">プラン</th>
                  <th scope="col">参加人数</th>
                  <th scope="col">利用期間</th>
                  <th scope="col">料金</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">無料</th>
                  <td>30人まで</td>
                  <td>作成から7日</td>
                  <td>
                    <strong>0円</strong>
                  </td>
                </tr>
                <tr>
                  <th scope="row">イベント</th>
                  <td>300人まで</td>
                  <td>決済確認から30日</td>
                  <td>
                    <strong>2,980円</strong>
                    <small>税込／1イベント</small>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="pricing-note">
            期間内のリハーサル・再ゲームに追加料金はありません。現在はStripe
            sandboxを使ったテスト公開です。
          </p>
          <button className="button primary" onClick={() => setCreate(true)}>
            30人まで無料で試す
          </button>
        </section>
        <section className="before-event">
          <h2>開催前に、会場でお試しください。</h2>
          <p>
            スマートフォンや会場の通信状況によって動作が変わります。幹事・参加者・投影の画面を少人数で開き、リハーサルをしておくと当日も進行しやすくなります。
          </p>
          <Link href="/guide" className="text-link">
            幹事の使い方ガイド
          </Link>
        </section>
      </main>
      <Footer />
      {create && <CreateRoom onClose={() => setCreate(false)} />}
    </>
  );
}
