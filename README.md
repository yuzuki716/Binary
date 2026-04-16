# Binary Options Automatic Simulator

バイナリーオプションの自動シミュレーターです。複数のテクニカルインジケーターの組み合わせとパラメータを自動でテストし、勝率ランキングを表示します。

## 機能

- **銘柄対応**: 為替 (EUR/USD, USD/JPY 等)、暗号資産 (BTC/USDT 等)、株価指数
- **インジケーター**: SMA/EMA クロス、RSI、MACD、ボリンジャーバンド、ストキャスティクス、複合ストラテジー
- **バックテスト**: 約76以上のパラメータ組み合わせを自動テスト
- **取引タイプ**: 1分 / 5分 バイナリーオプション（次のバー終値で勝敗判定）
- **モバイル対応**: スマートフォンで快適に使用可能

## 技術スタック

| 層 | 技術 |
|---|---|
| Backend | Python 3.11 + FastAPI + SQLite |
| Data | yfinance (為替/株式) + ccxt (暗号資産) |
| Indicators | pandas + numpy (独自実装) |
| Frontend | React 18 + Vite + TypeScript |
| Styling | TailwindCSS v4 |
| Charts | Lightweight Charts (TradingView) |
| State | Zustand |

## 起動方法

### バックエンド

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### フロントエンド

```bash
cd frontend
npm install
npm run dev
```

ブラウザで http://localhost:5173 を開いてください。

## 使い方

1. **設定画面**: 銘柄・時間足・取引時間・インジケーターを選択
2. **シミュレーション**: 「▶ シミュレーション開始」ボタンで実行（約30秒〜数分）
3. **結果画面**: 勝率順にランキング表示。フィルタリング可能
4. **チャート**: 各ストラテジーをタップするとチャートとトレード履歴を確認

## インジケーター一覧

| インジケーター | シグナル条件 | パラメータ数 |
|---|---|---|
| SMA クロス | ゴールデン/デッドクロス | 12通り |
| EMA クロス | ゴールデン/デッドクロス | 10通り |
| RSI | 過買い/過売りゾーンから復帰 | 16通り |
| MACD | シグナル線クロス | 6通り |
| ボリンジャーバンド | バンドタッチからの反発 | 9通り |
| ストキャスティクス | %K/%D クロス | 6通り |
| RSI + MA (複合) | 両インジケーターの合意 | 4通り |
| MACD + BB (複合) | 両インジケーターの合意 | 3通り |

## 勝敗判定ロジック

```
CALL シグナル: close[entry + N] > close[entry] → WIN
PUT  シグナル: close[entry + N] < close[entry] → WIN

N = 1 (1分取引) または 5 (5分取引)
```
