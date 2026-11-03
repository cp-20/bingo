import { createRoot } from "react-dom/client";
import RoomClient, { PrintCards } from "../src/components/room";
import Crew from "../src/components/crew";
import Landing from "../src/components/landing";
import { DEMO_ID, prepareDemo, previewBingo, resetDemo } from "./api";
import { useEffect } from "react";
import "../src/app/globals.css";
import "../src/app/venue.css";
import "./style.css";

function App() {
  useEffect(() => {
    if (new URLSearchParams(location.search).get("preview") === "bingo") {
      try {
        previewBingo();
        history.replaceState(null, "", location.pathname);
      } catch {
        /* The storage error is displayed by the entry screen. */
      }
    }
  }, []);
  try {
    prepareDemo();
  } catch {
    return (
      <main className="simple-page">
        <h1>ブラウザの保存領域を有効にしてください。</h1>
        <p>この体験デモは、同じブラウザ内で画面を切り替えて遊べます。</p>
      </main>
    );
  }
  const path = location.pathname;
  const role = path.startsWith("/join/")
    ? "player"
    : path.startsWith("/screen/")
      ? "screen"
      : "host";
  return (
    <>
      <aside className="demo-bar" aria-label="体験デモの操作">
        <details>
          <summary>
            <b>体験デモ</b>
            <span>課金なし</span>
            <span className="demo-toggle">画面を切り替える</span>
          </summary>
          <div>
            <span>サンプル6人で遊べます。同じブラウザ内で同期／課金なし</span>
          </div>
          <nav aria-label="デモ画面切り替え">
            {[
              ["幹事", `/host/${DEMO_ID}/`],
              ["景品係", `/crew/${DEMO_ID}/`],
              ["参加者", `/join/${DEMO_ID}/`],
              ["会場スクリーン", `/screen/${DEMO_ID}/`],
              ["紹介ページ", "/about/"],
            ].map(([label, href]) => (
              <a
                href={href}
                key={href}
                aria-current={path === href ? "page" : undefined}
              >
                {label}
              </a>
            ))}
            <button
              onClick={() =>
                location.assign(
                  `/${role === "screen" ? "screen" : "join"}/${DEMO_ID}/?preview=bingo`,
                )
              }
            >
              ビンゴの演出を試す
            </button>
            <button
              onClick={() => {
                if (
                  confirm("サンプルデータを最初に戻します。よろしいですか？")
                ) {
                  resetDemo();
                  location.assign(`/host/${DEMO_ID}/`);
                }
              }}
            >
              最初から遊ぶ ↻
            </button>
          </nav>
          <small>
            QR・参加リンクはこのブラウザの別タブで体験できます。他の端末とは同期しません。景品はすべて架空のサンプルです。
          </small>
        </details>
      </aside>
      {path.startsWith("/crew") ? (
        <Crew id={DEMO_ID} />
      ) : path.startsWith("/about") ? (
        <Landing />
      ) : path.endsWith("/print/") || path.endsWith("/print") ? (
        <PrintCards id={DEMO_ID} />
      ) : (
        <RoomClient id={DEMO_ID} role={role} />
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
