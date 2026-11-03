# ロリポップ！デプロイナウへの公開

## 前提

1. ロリポップのアカウントとCLIログイン。クラウド環境から実行する場合は `deploy.lolipop.jp` へのHTTPS通信が許可されていること。
2. 永続化されたlibSQL互換の外部DB（Tursoなど）と接続情報。ロリポップの内蔵DBは利用できません。
3. Stripe sandboxを利用する場合は、そのsandboxの制限付きAPIキーとWebhookエンドポイント。liveのキーやデータを使わないこと。

DB・Stripe・ロリポップのアカウント作成と認証は、実行者がアクセスできるアカウントで行ってください。本リポジトリに秘密情報は含まれません。

## アプリ設定

| 環境変数                                                        | 用途                                                                           |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `TURSO_DATABASE_URL`                                            | `libsql://...` またはHTTPSの外部DB URL。本番必須                               |
| `TURSO_AUTH_TOKEN`                                              | DBの認証トークン。機密として保存                                               |
| `APP_URL`                                                       | 公開URLのorigin。例：`https://実際の公開ホスト`                                |
| `STRIPE_SECRET_KEY`                                             | sandboxの `rk_test_` を推奨。Checkout Sessionsの作成・参照権限。機密として保存 |
| `STRIPE_WEBHOOK_SECRET`                                         | 該当sandbox・該当エンドポイントの署名シークレット。機密として保存              |
| `SELLER_NAME`, `SELLER_EMAIL`, `SELLER_ADDRESS`, `SELLER_PHONE` | 公開する販売者情報。本販売開始前に整備                                         |

キーは `NEXT_PUBLIC_` を付けず、サーバー専用にしてください。DBテーブルは最初のDBアクセスでバージョン付きの移行処理により準備します。デプロイ前にバックアップを取り、安全な実行環境で `npm run db:setup` を実行して移行を確認してください。古いアプリへの切り戻し時もDBを自動で巻き戻さず、互換性を確認します。公開環境で `BINGO_E2E` を設定しないでください。

```sh
npx lolipop login
npx lolipop project create --name bingo-room --framework next
npx lolipop project link 実際のプロジェクトID
```

ダッシュボードで上記の環境変数を設定します。秘密値は機密設定にし、CLIに値を直接渡すことは避けてください。CLIで設定する場合は `lolipop env create --sensitive` の対話入力を利用します。

```sh
npx lolipop deploy
npx lolipop project show --json
npx lolipop project logs --latest
```

デフォルト設定はインストール `npm ci --ignore-scripts`、ビルド `npm run build`、出力 `.next/standalone`。このアプリのビルドにインストール後スクリプトは必要ありません。ビルドの最後に静的ファイルをstandaloneへコピーするため、出力ディレクトリだけでCSSやアイコンを含めて配信できます。

## Stripe sandboxの設定

ダッシュボードまたは連携で**sandboxであることを確認**してから作業します。初期セットアップ時に読み取りのみの承認であれば、商品・Webhook等を作成せず、必要な設定内容を確認するところまでに留めてください。

このアプリはCheckout作成時にサーバー定義の価格データを渡すため、固定のProduct/Price IDは不要です。金額は必ずJPY 2,980、数量1です。決済方法はStripeの動的決済方法を使います。

Webhook URL：

```text
https://実際の公開ホスト/api/stripe/webhook
```

必要なイベント：

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`

このエンドポイントの署名シークレットを `STRIPE_WEBHOOK_SECRET` に設定し、再デプロイします。ブラウザが決済後の画面に戻ったことだけでは人数制限を解除しません。

## 公開後の確認

1. `/api/health` が200、`status: ok` を返す。さらに `/api/ready` が200を返す。生存確認だけではDB利用可能とは判断しない。
2. イベント作成・QR参加・抽選・再読み込みでのカード復帰。
3. 再デプロイ後に同じイベントとカードが残る。
4. sandboxで2,980円のテスト決済を実行し、Webhookで300人に切り替わる。
5. 重複通知、キャンセル、非同期決済の成功・失敗を確認する。
6. DBの切断・復帰、バックアップからの復元、予定人数での同時接続を試し、回線・レート上限を確認する。
7. readinessの外形監視、DBのバックアップ/PITR、期限切れデータの清掃を設定する。[運用手順](OPERATIONS.md) に担当と実測値を記録する。

ロリポップの公式プランではFreeは10リクエスト/秒、Personalは100リクエスト/秒です。参加者300人が3.5〜3.75秒ごとに参照すると、参加者分だけで平均約83リクエスト/秒になります。300人の販売・本番開催をする前に、Personal等の実測で足りる構成に変更し、負荷試験を行ってください。少人数のテストは無料枠から開始できます。料金変更を伴うプラン契約は、その金額を確認してから行ってください。

ローカルの300人相当テストはDB・公開プロキシ・会場回線の保証にはなりません。同時開催数を増やす際は参加者数の合計で容量を見積もります。監視や有料プランの契約は、このリポジトリの追加だけでは有効になりません。

## 公式資料

- [Next.js対応とstandalone設定](https://deploy.lolipop.jp/docs/frameworks/nextjs)
- [CLIリファレンス](https://deploy.lolipop.jp/docs/cli)
- [環境変数](https://deploy.lolipop.jp/docs/configuration/environment-variables)
- [プラン](https://deploy.lolipop.jp/docs/plans)
- [GitHub連携](https://deploy.lolipop.jp/docs/integrations/github)
