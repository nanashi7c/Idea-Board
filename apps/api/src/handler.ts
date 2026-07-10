// hono/aws-lambdaからAWS Lambda用アダプタ関数handleをインポート
import { handle } from "hono/aws-lambda";
// 同一ディレクトリのapp.tsからHonoアプリケーションインスタンスをインポート
import { app } from "./app";

// handle()でHonoアプリをAWS Lambdaが呼び出せる形式に変換し、handlerとしてexport
export const handler = handle(app);
