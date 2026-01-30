# みんぱくん（Minpakun）

北海道の民泊投資物件を分析し、収益シミュレーションを行うツール。

## 機能

1. **物件ポータルスクレイピング**: 健美家、楽待などから物件情報を自動取得
2. **収益シミュレーション**: 3シナリオ（ネガティブ/ニュートラル/ポジティブ）× 12ヶ月
3. **条件適合物件の抽出**: 販売価格 < 年間想定売上 × X倍率
4. **CSV出力**: シミュレーション結果をエクスポート
5. **Slack通知**: 条件に合致する新着物件を自動通知

## 技術スタック

- **Frontend**: Next.js (App Router) + TypeScript + Tailwind CSS + shadcn/ui
- **DB/Auth**: Supabase (Postgres + RLS)
- **Server/Jobs**: Netlify Functions + Scheduled Functions
- **スクレイピング**: Connector方式（サイトごとに実装を分離）

## セットアップ

### 1. 依存関係のインストール

```bash
npm install
```

### 2. 環境変数の設定

`.env.local` を作成:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxx/yyy/zzz
```

### 3. Supabaseのセットアップ

Supabase Dashboardまたは`supabase cli`で以下を実行:

```bash
# supabase/migrations/001_initial_schema.sql の内容を実行
```

### 4. 開発サーバーの起動

```bash
npm run dev
```

## ディレクトリ構成

```
src/
  app/                     # Next.js App Router
    api/                   # API Routes
      dashboard/stats/
      properties/
      saved-searches/
      settings/
    properties/            # 物件一覧・詳細
    saved-searches/        # 保存検索
    settings/              # 設定画面
      sites/
      scrape/
      costs/
      slack/
  components/
    layout/               # ナビゲーション等
    ui/                   # shadcn/ui コンポーネント
  lib/
    supabaseClient.ts     # クライアント用Supabase
    supabaseServer.ts     # サーバー用Supabase
  types/
    database.ts           # DB型定義

netlify/
  functions/
    jobs-scrape.mts       # スクレイピングジョブ
    jobs-simulate.mts     # シミュレーションジョブ
    jobs-notify.mts       # 通知ジョブ
    admin-trigger.mts     # 手動実行用
    _shared/
      supabase.mts
      log.mts
      http.mts
      slack.mts
      connectors/         # サイト別Connector
        types.mts
        index.mts
        kenbiya.mts
        rakumachi.mts
      normalize/          # 正規化ユーティリティ
        address.mts
        text.mts
      simulate/           # シミュレーションロジック
        types.mts
        index.mts
        heuristics.mts

supabase/
  migrations/
    001_initial_schema.sql
```

## Scheduled Functions

Netlify Scheduled Functionsにより以下が定期実行:

| ジョブ | スケジュール | 説明 |
|--------|-------------|------|
| jobs-scrape | 6時間ごと | ポータルサイトから物件取得 |
| jobs-simulate | 6時間ごと（+30分） | 新規物件のシミュレーション実行 |
| jobs-notify | 1時間ごと | 条件適合物件のSlack通知 |

## 画面構成

- `/` - ダッシュボード（統計・手動実行）
- `/properties` - 物件一覧（倍率フィルタ）
- `/properties/[id]` - 物件詳細（12ヶ月シミュレーション）
- `/saved-searches` - 保存検索のCRUD
- `/settings/sites` - ポータルサイトON/OFF
- `/settings/scrape` - スクレイプ条件（エリア・物件タイプ）
- `/settings/costs` - コスト設定（清掃費・OTA手数料等）
- `/settings/slack` - Slack Webhook設定

## Connectorの追加方法

新しいポータルサイトを追加する場合:

1. `netlify/functions/_shared/connectors/` に新しいファイルを作成
2. `Connector` インターフェイスを実装
3. `index.mts` にConnectorを登録
4. `portal_sites` テーブルにサイト情報を追加

## 注意事項

- スクレイピングは各サイトの利用規約を確認の上、低頻度で実行してください
- 本番環境ではRLSポリシーを適切に設定してください
- AirROI/AirDNA APIのキーがない場合はヒューリスティクス（推定値）が使用されます

## ライセンス

Private
