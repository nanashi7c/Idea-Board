// カード一覧の初期値・localStorage永続化ロジック。Konva版(canvas.tsx)とDOM自前実装版(canvas-dom.tsx)が同じボードデータを共有できるよう、レンダラーに依存しない部分をここに切り出している。
import { cardsSchema, type Card } from "shared";

export const STORAGE_KEY = "idea-board-spike-cards";

export const NOTE_WIDTH = 220;
export const NOTE_PADDING = 8;
export const NOTE_FONT_SIZE = 14;
export const NOTE_LINE_HEIGHT = 20;
export const NOTE_MIN_HEIGHT = NOTE_LINE_HEIGHT + NOTE_PADDING * 2;

export const COLUMN_WIDTH = 260;
export const COLUMN_TITLE_HEIGHT = 40;
export const COLUMN_PADDING = 12;
export const COLUMN_ROW_GAP = 8;
export const ADD_BUTTON_HEIGHT = 28;

export const DRAW_STROKE_COLOR = "#1f2937";
export const DRAW_STROKE_WIDTH = 2;

// アップロードされた画像の実サイズがそのままだと大きすぎることがあるため、この最大サイズに収まるよう縦横比を保って縮小して配置する。
export const IMAGE_MAX_WIDTH = 240;
export const IMAGE_MAX_HEIGHT = 240;

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

export function loadCards(): Card[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return initialCards;
    // 保存データは外部入力として扱い、cardsSchemaで検証してから使う(コーディング規約の方針: 外部入力はunknownで受けてzodでパースする)。
    const parsed = cardsSchema.safeParse(JSON.parse(saved));
    // 保存されていたデータが古い形式・壊れている場合はparsed.successがfalseになるので、その場合は初期カードにフォールバックして、アプリごと壊れることを防ぐ。
    return parsed.success ? parsed.data : initialCards;
  } catch {
    return initialCards;
  }
}

export function createNoteCard(x = 0, y = 0): Card {
  return {
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

// 幅・高さは1本目のストロークをaddStrokeToDrawCardで反映した時点で確定するため、ここでは最小値のプレースホルダーにしておく。
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

// IMAGE_MAX_WIDTH/IMAGE_MAX_HEIGHTを超える場合は縦横比を保ったまま縮小し、srcもその縮小後サイズでcanvasに描き直したdata URLにする(表示サイズだけ縮小してsrcは元画像のままだと、スマホ写真1枚でlocalStorageの容量上限(QuotaExceededError)を超えてしまうことがあったため)。
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

function measureCardHeight(card: Card, cards: Card[]): number {
  if (card.type === "column")
    return layoutColumnChildren(card, cards).totalHeight;
  return card.height;
}

// DOM版(canvas-dom.tsx)はCSSのflexが自動でやってくれるが、Konvaには自動レイアウト機能が無いため、各子カードの高さを上から順に積み上げて自前で位置を計算する。
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

// Columnの子カードは自身のx, yを使わず(layoutColumnChildrenが計算した相対位置を使う)、
// かつ親のColumn自体がさらに別のColumnの子である場合もあるため、親をたどりながら再帰的に解決する。
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
// 用途は2つ: 1. Columnを削除する時に子・孫以降のカードも一緒に削除する(カスケード削除)
// 2. あるColumnを別のColumnへドラッグでネストする時、自己参照・循環参照を防ぐ。
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

// 複数のColumnの領域が重なる(ネストしたColumnの内側など)場合は、最も面積が小さい＝最も内側のColumnを優先する。
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

// strokesはカードのx, yを原点とした相対座標で保持しているため、
// 1. 既存ストロークを一旦ワールド座標に戻す
// 2. 新しいストローク(引数はワールド座標)を含めて全ストロークのbounding boxを求め直す
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
