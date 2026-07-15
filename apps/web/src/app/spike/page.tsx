// このコンポーネント自体はサーバーでも一度評価されうるが、next/dynamicにssr:falseを渡すには呼び出し元がClient Componentである必要があるため指定する。
"use client";

// next/dynamic: コンポーネントを「実際に必要になったタイミングで」読み込む機能（コード分割）。
// 通常のimportだと最初のページ読み込み時に全部まとめてJSバンドルに含まれるが、
// dynamic()で読み込むと別ファイルとして分離され、実際に描画する時に取得しにいく。
import dynamic from "next/dynamic";

// SpikeCanvasを動的に読み込む定義。
// const SpikeCanvas = dynamic(
// 第1引数: 実際に読み込みたいコンポーネントを返すPromiseを返す関数。
// "./canvas" のパスはNext.jsがビルド時に対応するバンドルを静的解析するため、
// Konva版とDOM自前実装版の切り替えフラグ。
// true にするとDOM自前実装版(canvas-dom.tsx)を使う。
const USE_DOM_CANVAS = true;

// 三項演算子は選ばれなかった側の式を評価しないため、USE_DOM_CANVASがfalseの間は
// canvas-dom.tsx側の dynamic(() => import("./canvas-dom")...) という式自体が実行されない
// (importも発生しない)。true/falseを書き換えることで、実行される側を丸ごと入れ替える。
// "./canvas" / "./canvas-dom" のパスはNext.jsがビルド時に対応するバンドルを静的解析するため、
// 変数や動的な文字列ではなくリテラル文字列で書く必要がある（公式ドキュメントの制約）。
//   () => import("./canvas").then((mod) => mod.SpikeCanvas),
//   // ssr: false = サーバー側では一切描画しない（ブラウザ上でのみ描画する）という指定。
//   // Konva（react-konva）はブラウザのCanvas APIに依存しており、Node.jsサーバー環境にはCanvasが存在しないため、そのままではビルド/SSR時にエラーになる。
//   // ssr:falseにすることで、サーバー側の描画をスキップしクライアント到達後に初めて読み込む。
//   { ssr: false },
// );
const ActiveCanvas = USE_DOM_CANVAS
  ? dynamic(() => import("./canvas-dom").then((mod) => mod.SpikeCanvasDom), {
      ssr: false,
    })
  : dynamic(() => import("./canvas").then((mod) => mod.SpikeCanvas), {
      ssr: false,
    });

// /spike ページ本体。
// このpage.tsx自体はサーバーでも実行されるが、中のSpikeCanvasはssr:falseなので
// サーバーでは何も描画されず、ブラウザにJSが届いてから初めてCanvasが描画される。
export default function SpikePage() {
  // return <SpikeCanvas />;
  return <ActiveCanvas />;
}
