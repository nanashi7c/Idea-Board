// Node.js環境でHonoアプリを起動するためのserve関数をインポート
import { serve } from "@hono/node-server";
// ルーティング等が定義されたHonoアプリケーション本体をインポート
import { app } from "./app";

// 環境変数PORTを数値に変換し、未設定なら8787番ポートを使う
const port = Number(process.env.PORT ?? 8787);

// appのfetchハンドラを指定ポートでリスン開始し、起動後にコールバックを実行
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`api server listening on http://localhost:${info.port}`);
});