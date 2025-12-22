# 北海道民泊売上見積ツール

北海道全域の民泊物件の売上見積・収益シミュレーションツールです。
AirDNA Rentalizer API と連携し、住所から自動で緯度経度・最寄駅を取得、費用パラメータを入力することでネット収益をシミュレーションできます。

## 主な機能

- **住所→緯度経度自動変換**: Google Geocoding API
- **最寄駅自動検索**: OpenStreetMap Overpass API（Haversine距離計算）
- **売上推定**: AirDNA Rentalizer API連携（年次・月次）
- **費用パラメータ可変入力**: OTA手数料率、清掃費、リネン費、運営代行率など
- **ネット売上・粗利計算**: 3レンジ（保守/標準/強気）でシミュレーション

## 技術スタック

- **フロント**: Next.js 16 (App Router, TypeScript)
- **スタイリング**: Tailwind CSS v4 + shadcn/ui
- **バックエンド**: Next.js API Routes
- **データベース**: Supabase (PostgreSQL)
- **デプロイ**: Netlify

## セットアップ

### 1. 依存関係のインストール

```bash
npm install
```

### 2. 環境変数の設定

以下の環境変数を `.env.local` に設定してください：

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Google Maps
GOOGLE_MAPS_API_KEY=your_google_maps_api_key

# AirDNA
AIRDNA_API_KEY=your_airdna_api_key
```

### 3. データベースのセットアップ

Supabaseのダッシュボードで `supabase/schema.sql` を実行してテーブルを作成してください。

### 4. 開発サーバーの起動

```bash
npm run dev
```

http://localhost:3000 でアプリケーションにアクセスできます。

## 外部API

### Google Geocoding API
- 住所から緯度経度を取得
- [Google Cloud Console](https://console.cloud.google.com/) でAPIキーを取得

### OpenStreetMap Overpass API
- 最寄駅の検索に使用
- 無料で利用可能（レート制限あり）
- [Overpass API ドキュメント](https://wiki.openstreetmap.org/wiki/Overpass_API)

### AirDNA Rentalizer API
- 民泊売上推定に使用
- Enterprise/API契約が必要
- [AirDNA](https://www.airdna.co/) で契約

**注意**: 開発時は `src/lib/airdna.ts` の `USE_MOCK_AIRDNA = true` でモックデータを使用できます。

## DBスキーマ

### properties（物件マスター）
- id, name, address_text, lat, lng, capacity, layout_text, bedrooms, bathrooms, description, notes

### cost_profiles（費用パラメータ）
- ota_fee_rate, cleaning_cost_per_turnover, linen_cost_per_turnover, consumables_cost_per_night
- utilities_cost_per_month, management_fee_rate, avg_stay_nights, other_fixed_cost_per_month

### estimates（試算結果）
- geocode_result, nearest_station, airdna_request, airdna_response, computed, status, error_message

## 計算ロジック

### ターンオーバー回数推定
```
occupied_nights = days_in_month × occupancy_rate
turnovers = occupied_nights ÷ avg_stay_nights
```

### 費用控除
```
ota_fee = gross_revenue × ota_fee_rate
management_fee = gross_revenue × management_fee_rate
cleaning = turnovers × cleaning_cost_per_turnover
linen = turnovers × linen_cost_per_turnover
consumables = occupied_nights × consumables_cost_per_night
fixed = utilities_cost_per_month + other_fixed_cost_per_month
```

### ネット収益
```
net_revenue = gross_revenue - (ota_fee + management_fee + cleaning + linen + consumables + fixed)
```

### 3レンジ
- **保守的**: gross × 0.85, occupancy - 5pt
- **標準**: gross × 1.00
- **強気**: gross × 1.15, occupancy + 5pt

## デプロイ（Netlify）

1. Netlifyでプロジェクトを作成
2. 環境変数を設定（Site settings → Environment variables）
3. ビルドコマンド: `npm run build`
4. パブリッシュディレクトリ: `.next`

## 今後の拡張予定

- [ ] 物件編集機能
- [ ] CSVエクスポート
- [ ] シーズナリティ分析（ニセコ・倶知安向け）
- [ ] 投資判断機能（家賃/ローン/減価償却/固定資産税→営業利益・回収期間）
- [ ] Beds24/会計データとの実績比較・補正係数
