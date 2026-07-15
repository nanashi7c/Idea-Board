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

// Columnカードの見た目に関する定数。中に入れたカードは縦リストで並べ、
// 子カードの量に応じてColumn自体の高さを自動計算する（実際の計算はlayoutColumnChildren、
// 描画は各canvasコンポーネント側で行う。ここでは両レンダラーで揃えるためのレイアウト値のみ定義する）。
export const COLUMN_WIDTH = 260;
export const COLUMN_TITLE_HEIGHT = 40;
export const COLUMN_PADDING = 12;
export const COLUMN_ROW_GAP = 8;
// Column内の「+ Note」ボタンの高さ。layoutColumnChildrenがaddButtonYの算出に使うため、
// レイアウト計算そのものと同じ場所（レンダラー非依存側）に置く。
export const ADD_BUTTON_HEIGHT = 28;

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

// 新しいImageカードを1枚作る。サイドバーのImageアイコンで選択したファイルをImage要素として
// 読み込んだ後に呼ばれる。IMAGE_MAX_WIDTH/IMAGE_MAX_HEIGHTを超える場合は縦横比を保ったまま
// 縮小し、srcもその縮小後サイズでcanvasに描き直したdata URLにする
// (表示サイズだけ縮小してsrcは元画像のままだと、スマホ写真1枚でlocalStorageの容量上限
// (QuotaExceededError)を超えてしまうことがあったため)。
export function createImageCard(
  x: number,
  y: number,
  img: HTMLImageElement,
): Card {
  const ratio = Math.min(
    1,
    IMAGE_MAX_WIDTH / img.naturalWidth,
    IMAGE_MAX_HEIGHT / img.naturalHeight,
  );
  const width = Math.round(img.naturalWidth * ratio);
  const height = Math.round(img.naturalHeight * ratio);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);

  return {
    id: crypto.randomUUID(),
    type: "image",
    x,
    y,
    width,
    height,
    src: canvas.toDataURL("image/jpeg", 0.85),
  };
}

// あるColumnの中に入っている（＝トップレベルでは描画しない）カードのidを全Column分集める。
// Column自身が別のColumnの中に入っている場合も、cardsに含まれる全Columnを見るため
// 再帰しなくても孫以降のidまで自然に集まる（cardsはネストの深さに関係なくフラットな配列で、
// 親子関係はcardIdsによる参照だけで表現しているため）。
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

export type ColumnCard = Extract<Card, { type: "column" }>;
type DrawCard = Extract<Card, { type: "draw" }>;

// Columnの子カード1件が縦方向に占める高さ。子がColumn（ネストしたColumn）の場合は、
// そのColumn自身の子カードの量に応じて高さが変わるため、layoutColumnChildrenを再帰的に
// 呼んでtotalHeightを求める。
function measureCardHeight(card: Card, cards: Card[]): number {
  if (card.type === "column")
    return layoutColumnChildren(card, cards).totalHeight;
  return card.height;
}

// Column内の子カード（Note/Image/Swatch/Draw/Column、種類は問わない）を縦に並べるための
// レイアウト計算。DOM版(canvas-dom.tsx)はCSSのflexが自動でやってくれるが、Konvaには
// 自動レイアウト機能が無いため、各子カードの高さ（Columnなら再帰的に計算したtotalHeight、
// それ以外はcard.height）を上から順に積み上げて自前で位置を計算する。
// canvas.tsxではこの計算結果を「Column内の子カードを描画する処理」と「編集用
// textarea/inputオーバーレイの位置計算(getCardWorldPosition)」の両方から参照する。
export function layoutColumnChildren(column: ColumnCard, cards: Card[]) {
  const children = column.cardIds
    .map((id) => cards.find((c) => c.id === id))
    .filter((c): c is Card => !!c);
  let cursorY = COLUMN_TITLE_HEIGHT + COLUMN_PADDING;
  const items = children.map((child) => {
    const item = { child, x: COLUMN_PADDING, y: cursorY };
    cursorY += measureCardHeight(child, cards) + COLUMN_ROW_GAP;
    return item;
  });
  return {
    items,
    addButtonY: cursorY,
    totalHeight: cursorY + ADD_BUTTON_HEIGHT + COLUMN_PADDING,
  };
}

// あるカードが実際にキャンバス上のどのワールド座標に描画されているかを求める。
// トップレベルのカードは自身のx, yをそのまま使えるが、Columnの子カードは自身のx, yを使わず
// （layoutColumnChildrenが計算した相対位置を使う）、かつ親のColumn自体がさらに別のColumnの
// 子である場合もあるため、親をたどりながら再帰的に解決する。
export function getCardWorldPosition(
  cardId: string,
  cards: Card[],
): { x: number; y: number } | null {
  const card = cards.find((c) => c.id === cardId);
  if (!card) return null;
  const parent = cards.find(
    (c): c is ColumnCard => c.type === "column" && c.cardIds.includes(cardId),
  );
  if (!parent) return { x: card.x, y: card.y };
  const parentPos = getCardWorldPosition(parent.id, cards);
  if (!parentPos) return { x: card.x, y: card.y };
  const item = layoutColumnChildren(parent, cards).items.find(
    (i) => i.child.id === cardId,
  );
  return item
    ? { x: parentPos.x + item.x, y: parentPos.y + item.y }
    : parentPos;
}

// columnIdを起点に、子Column→孫Column…とcardIdsをたどれる全ての子孫カードidを集める。
// 用途は2つ：
// 1. Columnを削除する時、子・孫以降のカードも一緒に削除する（カスケード削除）
// 2. あるColumnを別のColumnへドラッグでネストする時、そのColumn自身や子孫Columnへは
//    ネストできないようにする（自己参照・循環参照の防止）
export function collectDescendantIds(
  columnId: string,
  cards: Card[],
): Set<string> {
  const result = new Set<string>();
  const stack = [columnId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined) continue;
    const column = cards.find(
      (c): c is ColumnCard => c.id === id && c.type === "column",
    );
    if (!column) continue;
    for (const childId of column.cardIds) {
      if (!result.has(childId)) {
        result.add(childId);
        stack.push(childId);
      }
    }
  }
  return result;
}

// あるワールド座標の点を受け止められるColumnを探す。excludeCardIdとその子孫
// （excludeCardId自身がColumnの場合）は候補から除外し、自己ネスト・循環ネストを防ぐ。
// 新規カードをドロップ位置に配置する場合はexcludeCardIdにまだcardsへ含まれていない
// idを渡せばよく（該当Columンが無いので除外は実質発生しない）、既存カードを
// ドラッグして再ネストする場合はそのカード自身のidを渡す。
// 複数のColumnの領域が重なる（ネストしたColumnの内側など）場合は、最も面積が小さい
// ＝最も内側のColumnを優先する。
export function findDropTargetColumn(
  point: { x: number; y: number },
  excludeCardId: string,
  cards: Card[],
): ColumnCard | null {
  const excluded = new Set([
    excludeCardId,
    ...collectDescendantIds(excludeCardId, cards),
  ]);
  let best: { column: ColumnCard; area: number } | null = null;
  for (const card of cards) {
    if (card.type !== "column" || excluded.has(card.id)) continue;
    const pos = getCardWorldPosition(card.id, cards);
    if (!pos) continue;
    const { totalHeight } = layoutColumnChildren(card, cards);
    const withinX = point.x >= pos.x && point.x <= pos.x + COLUMN_WIDTH;
    const withinY = point.y >= pos.y && point.y <= pos.y + totalHeight;
    if (!withinX || !withinY) continue;
    const area = COLUMN_WIDTH * totalHeight;
    if (!best || area < best.area) best = { column: card, area };
  }
  return best?.column ?? null;
}

// 既存カードcardIdを、ドラッグ操作の結果に応じて移動する。
// - target.columnId: 現在の親Column（あれば）から外し、指定Columnのcardidsへ追加する。
// - target.worldPos: 現在の親Column（あれば）から外し、トップレベルのカードとして
//   worldPosの位置に置く（すでにトップレベルだった場合は単なる位置更新になる）。
export function moveCardTo(
  cards: Card[],
  cardId: string,
  target: { columnId: string } | { worldPos: { x: number; y: number } },
): Card[] {
  const detached = cards.map((c) =>
    c.type === "column" && c.cardIds.includes(cardId)
      ? { ...c, cardIds: c.cardIds.filter((id) => id !== cardId) }
      : c,
  );
  if ("columnId" in target) {
    return detached.map((c) =>
      c.id === target.columnId && c.type === "column"
        ? { ...c, cardIds: [...c.cardIds, cardId] }
        : c,
    );
  }
  return detached.map((c) =>
    c.id === cardId ? { ...c, x: target.worldPos.x, y: target.worldPos.y } : c,
  );
}

// 新規カードnewCardをワールド座標pointに配置する。pointが既存Columnの領域内であれば、
// トップレベルには追加せずそのColumnの子として追加する（サイドバーからのドラッグ&ドロップ、
// および画像ファイルのドロップの両方で使う）。
export function insertCardAtPoint(
  cards: Card[],
  newCard: Card,
  point: { x: number; y: number },
): Card[] {
  const target = findDropTargetColumn(point, newCard.id, cards);
  if (!target) return [...cards, newCard];
  return [
    ...cards.map((c) =>
      c.id === target.id && c.type === "column"
        ? { ...c, cardIds: [...c.cardIds, newCard.id] }
        : c,
    ),
    newCard,
  ];
}

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
