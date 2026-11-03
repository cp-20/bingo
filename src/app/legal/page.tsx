import Document from "@/components/document";
export const metadata = { title: "販売条件・特定商取引法に基づく表記" };
export const dynamic = "force-dynamic";
export default function Legal() {
  return (
    <Document title="販売条件" tag="SALES INFORMATION">
      <div className="notice">
        現在はsandboxのテスト公開です。実際の請求は発生せず、本販売は開始していません。販売者情報と本番決済の準備が整い次第、本ページを更新します。
      </div>
      <dl className="legal-list">
        <dt>サービス名</dt>
        <dd>BINGO ROOM</dd>
        <dt>販売者名</dt>
        <dd>{process.env.SELLER_NAME || "本販売開始前に掲載"}</dd>
        <dt>所在地</dt>
        <dd>{process.env.SELLER_ADDRESS || "本販売開始前に掲載"}</dd>
        <dt>電話番号</dt>
        <dd>{process.env.SELLER_PHONE || "本販売開始前に掲載"}</dd>
        <dt>連絡先</dt>
        <dd>{process.env.SELLER_EMAIL || "本販売開始前に掲載"}</dd>
        <dt>提供価格</dt>
        <dd>
          無料プラン：0円・最大30人・7日間
          <br />
          イベントプラン：1イベント2,980円（税込）・最大300人・決済確認から30日間
        </dd>
        <dt>その他の費用</dt>
        <dd>
          インターネット接続料、会場・通信機器、景品の代金と配布・配送費は利用者負担です。
        </dd>
        <dt>支払方法・時期</dt>
        <dd>
          Stripe
          Checkoutに表示する決済方法による事前決済。現在はsandboxテストのみです。
        </dd>
        <dt>提供時期</dt>
        <dd>
          決済確認後、当該イベントの参加人数上限を解除します。反映に時間がかかる場合があります。
        </dd>
        <dt>更新・解約</dt>
        <dd>期間制の単発購入です。自動更新や解約手続きはありません。</dd>
        <dt>返金・キャンセル</dt>
        <dd>
          テスト公開中のため実際の請求・返金は発生しません。本販売開始前に、未利用時・当サービスの障害時・主催者都合などの条件を本ページに明記します。
        </dd>
        <dt>動作環境</dt>
        <dd>
          CookieとJavaScriptが有効な最新のSafari、Chrome、Edge等。インターネット接続が必要です。事前に無料プランでご利用の端末・会場の接続状況をご確認ください。
        </dd>
      </dl>
    </Document>
  );
}
