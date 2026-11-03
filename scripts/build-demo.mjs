import { build } from "esbuild";
import { mkdir, writeFile, copyFile, cp, rm } from "node:fs/promises";
import { resolve } from "node:path";
const output = resolve("demo/dist");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await build({
  entryPoints: ["demo/main.tsx"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  minify: true,
  jsx: "automatic",
  outfile: `${output}/app.js`,
  define: { "process.env.NODE_ENV": '"production"' },
  alias: {
    "@/lib/client": resolve("demo/api.ts"),
    "@": resolve("src"),
    "next/link": resolve("demo/link.tsx"),
  },
  logLevel: "warning",
});
const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="description" content="幹事・参加者・会場スクリーンを切り替えて遊べるBINGO ROOMの体験デモ。課金なし。"><title>BINGO ROOM｜体験デモ</title><link rel="icon" href="/icon.svg"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`;
for (const path of [
  "",
  "about",
  "host/DEMO8888",
  "host/DEMO8888/print",
  "join/DEMO8888",
  "screen/DEMO8888",
  "crew/DEMO8888",
]) {
  await mkdir(`${output}/${path}`, { recursive: true });
  await writeFile(`${output}/${path}/index.html`, html);
}
await cp("public/demo-prizes", `${output}/demo-prizes`, { recursive: true });
await copyFile("src/app/icon.svg", `${output}/icon.svg`);
// Static copies keep documentation links useful without routing to the production service.
for (const [path, title, text] of [
  [
    "guide",
    "デモの遊び方",
    "上の画面切り替えで幹事・参加者・会場スクリーンを開けます。最初から遊ぶとサンプル6人のゲームに戻ります。同じブラウザの別タブで同期します。実イベントの作成や決済には対応していません。",
  ],
  [
    "privacy",
    "デモの保存について",
    "サンプルのカード・抽選結果をこのブラウザのlocalStorageに保存します。外部サーバーへの送信・決済・個人情報の収集はありません。他の端末とは同期しません。",
  ],
  [
    "terms",
    "体験デモについて",
    "このサイトはBINGO ROOMの操作体験用です。実際のイベント運営・課金には利用できません。",
  ],
  [
    "legal",
    "販売について",
    "このデモでは販売・決済を行いません。紹介ページの価格は予定プランの説明です。",
  ],
]) {
  await mkdir(`${output}/${path}`, { recursive: true });
  await writeFile(
    `${output}/${path}/index.html`,
    `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}｜BINGO ROOM デモ</title><link rel="stylesheet" href="/app.css"></head><body><main class="simple-page"><h1>${title}</h1><p>${text}</p><a class="button primary" href="/">体験デモへ戻る</a></main></body></html>`,
  );
}
await writeFile(
  `${output}/_headers`,
  "/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; frame-ancestors 'none'; base-uri 'self'\n",
);
console.log(
  "Built browser-local demo into demo/dist using the application's existing screens.",
);
