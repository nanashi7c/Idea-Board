// build関数はjs/tsファイルをバンドル・変換するesbuildのAPIエントリーポイント
import { build } from "esbuild";

// build関数を呼び出してビルドを実行する
// build関数はPromiseを返す非同期関数のため、awaitで完了を待つ
// トップレベルawaitを使っているため、このファイルはESM(.mjs)として実行される
await build({
  // ビルド対象のエントリーファイルを指定する
  // ここではsrc/handler.tsを起点に依存関係を辿ってビルドする
  entryPoints: ["src/handler.ts"],
  // importで参照している依存モジュールをファイル自体に埋め込む（バンドルする）
  bundle: true,
  // 出力先の実行環境をNode.jsに指定する。
  // platform:"node"にすると、fs等Node.jsの組み込みモジュールは自動的に外部化(externalに)
  platform: "node",
  // 変換対象のNode.jsバージョンをNode.js24系に指定する。
  target: "node24",
  // ビルド結果を出力する単位jつファイルのパスを指定する
  outfile: "dist/handler.js",
  // 出力モジュール形式をCommonJS(cjs)に指定する
  format: "cjs",
});
