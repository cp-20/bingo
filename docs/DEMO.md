# 体験デモ

[Sitesのデモ](https://bingo-room-demo.cp20-dev.chatgpt.site)は、実際の画面と判定を使ったブラウザ内の操作体験です。架空の写真付き景品3個とサンプル6人で始まり、上部から幹事・参加者・投影・景品係を切り替えられます。「ビンゴの演出を試す」は固定サンプルに切り替え、リーチから当選への表示を再現します。

課金・実イベントの作成・端末間の同期はありません。同じブラウザのlocalStorageを使い、アプリの外部APIやStripeへリクエストしません。デモの操作は `demo/` に限定し、公開アプリのサーバーや抽選APIには組み込みません。

```sh
npm ci
npm run build:demo
python3 -m http.server 4173 --bind 127.0.0.1 --directory demo/dist
```

http://127.0.0.1:4173/ を開きます。ビルドはesbuild、プレビューとテストの静的サーバーはPython 3を使います。

```sh
npx playwright install chromium webkit
npm run test:demo
BINGO_TEST_BROWSER=webkit npm run test:demo
```

本体の部品とCSSを読み込み、通信層とLinkだけを差し替えます。共有する判定は `src/lib/card.ts`。`scripts/build-demo.mjs` が各URL・説明ページ・ヘッダーを生成します。全75回、同一カードの復帰、別タブへの反映、印刷、演出の終了と動き抑制、景品の紹介・チャットの選択投影・受け取り番号による受け渡しを検査します。
