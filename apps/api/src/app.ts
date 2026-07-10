// Hono フレームワークをインポート。
import { Hono } from "hono";
// CORSミドルウェア（クロスオリジン許可）をインポート。
import { cors } from "hono/cors";

// Hono のインスタンス app を生成し、export。
export const app = new Hono();

// ALLOWED_ORIGIN が設定されている時だけCORSを許可する
if (process.env.ALLOWED_ORIGIN) {
  app.use("*", cors({ origin: process.env.ALLOWED_ORIGIN }));
}

// ヘルスチェック用のGETエンドポイントを定義
app.get("/healthz", (c) => c.json({ status: "ok" }));
