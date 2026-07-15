// カード一覧の初期値・localStorage永続化ロジック。
// Konva版(canvas.tsx)とDOM自前実装版(canvas-dom.tsx)が同じボードデータを共有できるよう、
// レンダラーに依存しない部分をここに切り出している。
// packages/shared で定義したzodスキーマ・型をそのままフロントでも使う。
// cardsSchema: カード配列のバリデーション用（localStorageの中身が壊れていないか検証する）
// Card: カード1枚分のTypeScript型（note/image/swatch/column/drawのunion型）
import { cardsSchema, type Card } from "shared";

// localStorageに保存する際のキー名。ブラウザのlocalStorageは文字列キーで値を出し入れするだけの単純なkey-valueストレージなので、他のアプリのデータと衝突しないよう固有の名前にしている。
export const STORAGE_KEY = "idea-board-spike-cards";

// Noteカードの見た目に関する定数。横長カードで、テキストは縦センタリング、
// 表示行数（折り返し含む）に応じて高さが伸びる仕様のため、1行あたりの高さを
// canvas-dom版（実測のDOM要素）とcanvas版（Konvaのテキスト測定）の両方で共有する。
export const NOTE_WIDTH = 220;
export const NOTE_PADDING = 8;
export const NOTE_FONT_SIZE = 14;
export const NOTE_LINE_HEIGHT = 20;
export const NOTE_MIN_HEIGHT = NOTE_LINE_HEIGHT + NOTE_PADDING * 2;

// Columnカードの見た目に関する定数。中に入れたNoteは縦リストで並べ、
// Note数に応じてColumn自体の高さを自動計算する（実際の計算は各canvasコンポーネント側で行う。
// ここでは両レンダラーで揃えるためのレイアウト値のみ定義する）。
export const COLUMN_WIDTH = 260;
export const COLUMN_TITLE_HEIGHT = 40;
export const COLUMN_PADDING = 12;
export const COLUMN_ROW_GAP = 8;

// Drawカードのペン設定。
export const DRAW_STROKE_COLOR = "#1f2937";
export const DRAW_STROKE_WIDTH = 2;

// Imageカードの見た目に関する定数。アップロードされた画像の実サイズがそのままだと
// 大きすぎることがあるため、この最大サイズに収まるよう縦横比を保って縮小して配置する。
export const IMAGE_MAX_WIDTH = 240;
export const IMAGE_MAX_HEIGHT = 240;

// 初回アクセス時（localStorageに何も保存されていない時）に表示する初期カード。
// Note（付箋）1枚とSwatch（色見本）1枚を最初から置いておくことで、
// 操作方法を説明しなくても「動かせるもの」がある状態からスタートできるようにしている。
const initialCards: Card[] = [
  {
    id: "1",
    type: "note",
    x: 50,
    y: 50,
    width: 160,
    height: 120,
    text: "はじめてのメモ",
    color: "#fff2a8",
  },
  {
    id: "2",
    type: "swatch",
    x: 260,
    y: 50,
    width: 120,
    height: 80,
    hex: "#3b82f6",
  },
];

// localStorageからカード一覧を読み込む関数。
// useStateの初期値としてそのまま渡す（後述）ため、副作用を持たない純粋な関数として書いている。
export function loadCards(): Card[] {
  try {
    // localStorageには文字列しか保存できないので、保存時にJSON.stringifyした文字列を取り出す。
    const saved = localStorage.getItem(STORAGE_KEY);
    // まだ一度も保存していない（初回アクセス）場合は初期カードを返す。
    if (!saved) return initialCards;
    // 保存データは外部入力として扱い、cardsSchemaで検証してから使う。
    // JSON.parseしただけの値は「形が合っているかどうか不明なany型」なので、
    // コーディング規約の方針（外部入力はunknownで受けてzodでパースする）に沿って、cardsSchemaで検証してから使う。ここが今回のspikeでzodスキーマが実際に役立つ場面。
    const parsed = cardsSchema.safeParse(JSON.parse(saved));
    // safeParseは例外を投げず、成功/失敗を判定結果として返す。
    // 保存されていたデータが古い形式・壊れている場合はparsed.successがfalseになるので、
    // その場合は初期カードにフォールバックして、アプリごと壊れることを防ぐ。
    return parsed.success ? parsed.data : initialCards;
  } catch {
    // JSON.parse自体が失敗する（壊れた文字列が保存されていた等）場合もここで拾って初期値に戻す。
    return initialCards;
  }
}

// 新しいNoteカードを1枚作る。サイドバーからのドラッグ&ドロップ（x, yはドロップ位置）、
// およびColumn内の「+」ボタン（親のColumnが位置を管理するのでx, yは0のまま）の両方から使う。
export function createNoteCard(x = 0, y = 0): Card {
  return {
    // crypto.randomUUID(): ブラウザ標準のAPIで、衝突しないランダムなID文字列を生成する。
    // 初期カードのidは"1"/"2"という固定文字列だが、新規作成分は動的に一意なIDが必要なため使用。
    id: crypto.randomUUID(),
    type: "note",
    x,
    y,
    width: NOTE_WIDTH,
    height: NOTE_MIN_HEIGHT,
    text: "新しいメモ",
    color: "#fff2a8",
  };
}

// 新しいColumnカードを1枚作る。サイドバーからのドラッグ&ドロップ用。
export function createColumnCard(x: number, y: number): Card {
  return {
    id: crypto.randomUUID(),
    type: "column",
    x,
    y,
    width: COLUMN_WIDTH,
    height: COLUMN_TITLE_HEIGHT + COLUMN_PADDING * 2,
    title: "新しいColumn",
    cardIds: [],
  };
}

// 新しいDrawカードを1枚作る。サイドバーのDrawアイコンでペンモードに入った直後、
// 最初のストロークを引いた瞬間に呼ばれる。幅・高さは1本目のストロークを
// addStrokeToDrawCardで反映した時点で確定するため、ここでは最小値のプレースホルダーにしておく。
export function createDrawCard(x: number, y: number): Card {
  return {
    id: crypto.randomUUID(),
    type: "draw",
    x,
    y,
    width: 1,
    height: 1,
    strokes: [],
  };
}

// 新しいImageカードを1枚作る。サイドバーのImageアイコンで選択したファイルを
// FileReaderでdata URL化し、Imageで実サイズ(naturalWidth/naturalHeight)を取得した後に呼ばれる。
// IMAGE_MAX_WIDTH/IMAGE_MAX_HEIGHTを超える場合は、縦横比を保ったまま縮小する。
export function createImageCard(
  x: number,
  y: number,
  src: string,
  naturalWidth: number,
  naturalHeight: number,
): Card {
  const ratio = Math.min(
    1,
    IMAGE_MAX_WIDTH / naturalWidth,
    IMAGE_MAX_HEIGHT / naturalHeight,
  );
  return {
    id: crypto.randomUUID(),
    type: "image",
    x,
    y,
    width: Math.round(naturalWidth * ratio),
    height: Math.round(naturalHeight * ratio),
    src,
  };
}

// あるColumnの中に入っている（＝トップレベルでは描画しない）Noteのidを全Column分集める。
// cards.map(...)でカードを1件ずつ描画するcanvas.tsx / canvas-dom.tsxの両方で、
// 「Columnに属するカードはColumnの中でだけ描画する」という条件分岐に使う。
export function getColumnChildIds(cards: Card[]): Set<string> {
  const ids = new Set<string>();
  for (const card of cards) {
    if (card.type === "column") {
      for (const id of card.cardIds) ids.add(id);
    }
  }
  return ids;
}

type DrawCard = Extract<Card, { type: "draw" }>;

// Drawカードに新しいストロークを1本追加する。
// strokesはカードのx, yを原点とした相対座標で保持しているため、
// 1. 既存ストロークを一旦ワールド座標に戻す
// 2. 新しいストローク（引数はワールド座標）を含めて全ストロークのbounding boxを求め直す
// 3. bounding boxの左上を新しい原点(x, y)とし、全ストロークをその原点からの相対座標に変換する
// という手順で、カード全体をドラッグしても中のストロークがズレないようにしている。
export function addStrokeToDrawCard(
  card: DrawCard,
  worldPoints: { x: number; y: number }[],
): DrawCard {
  if (worldPoints.length === 0) return card;

  const existingWorldStrokes = card.strokes.map((stroke) =>
    stroke.map((p) => ({ x: p.x + card.x, y: p.y + card.y })),
  );
  const allStrokes = [...existingWorldStrokes, worldPoints];
  const allPoints = allStrokes.flat();
  const minX = Math.min(...allPoints.map((p) => p.x));
  const minY = Math.min(...allPoints.map((p) => p.y));
  const maxX = Math.max(...allPoints.map((p) => p.x));
  const maxY = Math.max(...allPoints.map((p) => p.y));

  return {
    ...card,
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
    strokes: allStrokes.map((stroke) =>
      stroke.map((p) => ({ x: p.x - minX, y: p.y - minY })),
    ),
  };
}
