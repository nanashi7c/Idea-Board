// localStorage/pointer event等ブラウザAPIに依存するため、Client Componentとして実行する。
"use client";

import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type {
  Dispatch,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  RefObject,
  SetStateAction,
} from "react";
import type { Card } from "shared";
// レイアウト計算等Konvaに依存しないデータ操作はcanvas.tsxと共有できるようboard-storage.tsに切り出している。ただし、Column内の子カード位置はDOM版ではCSS flexboxの通常フロー要素として描画しブラウザに計算を任せているため、ドロップ先のColumn判定はこのファイル内でgetBoundingClientRect()を使った別実装(findDropTargetColumnAtClientPoint)にしている。
import {
  STORAGE_KEY,
  createNoteCard,
  createColumnCard,
  createDrawCard,
  createImageCard,
  addStrokeToDrawCard,
  getColumnChildIds,
  collectDescendantIds,
  moveCardTo,
  insertCardAtPoint,
  loadCards,
  NOTE_WIDTH,
  NOTE_PADDING,
  NOTE_FONT_SIZE,
  NOTE_MIN_HEIGHT,
  COLUMN_WIDTH,
  COLUMN_TITLE_HEIGHT,
  COLUMN_PADDING,
  COLUMN_ROW_GAP,
  DRAW_STROKE_COLOR,
  DRAW_STROKE_WIDTH,
  type ColumnCard as ColumnCardType,
} from "./board-storage";
import { Sidebar, CARD_TYPE_DRAG_MIME } from "./toolbar";

const ZOOM_STEP = 1.05;

type NoteCard = Extract<Card, { type: "note" }>;
type SwatchCardType = Extract<Card, { type: "swatch" }>;
type ImageCardType = Extract<Card, { type: "image" }>;
type DrawCardType = Extract<Card, { type: "draw" }>;

// Note/Columnはコンテンツ量に応じて高さが変わる。固定値をstyleに書く代わりに、実際にDOMへレンダリングされた高さをResizeObserverで測定し、cards配列のheightへ書き戻す。「測定→setCards→再描画→再測定」が無限ループにならないよう、直前に測定した高さはrefで持ち、変化が無ければsetCardsを呼ばない。
function useSyncMeasuredHeight(
  ref: RefObject<HTMLElement | null>,
  cardId: string,
  currentHeight: number,
  setCards: Dispatch<SetStateAction<Card[]>>,
) {
  const heightRef = useRef(currentHeight);
  heightRef.current = currentHeight;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const measured = Math.round(entry.contentRect.height);
      if (measured > 0 && measured !== heightRef.current) {
        setCards((prev) =>
          prev.map((c) => (c.id === cardId ? { ...c, height: measured } : c)),
        );
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId]);
}

// トップレベル(絶対配置)とColumn内の子カード(flexレイアウトに従う通常のブロック要素)の両方から呼ばれる。ネストされたカードも実際に動かせばトップレベルへ昇格する(詳細はSpikeCanvasDom内のhandleCardPointerDown参照)。
function NoteCardView({
  card,
  nested,
  isSelected,
  isEditing,
  onStartEdit,
  onCommitText,
  onPointerDownDrag,
  registerRef,
  setCards,
}: {
  card: NoteCard;
  nested: boolean;
  isSelected: boolean;
  isEditing: boolean;
  onStartEdit: () => void;
  onCommitText: (text: string) => void;
  onPointerDownDrag: (e: ReactPointerEvent<HTMLDivElement>) => void;
  registerRef: (el: HTMLDivElement | null) => void;
  setCards: Dispatch<SetStateAction<Card[]>>;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  useSyncMeasuredHeight(elRef, card.id, card.height, setCards);

  return (
    <div
      ref={(el) => {
        elRef.current = el;
        registerRef(el);
      }}
      onPointerDown={onPointerDownDrag}
      onDoubleClick={onStartEdit}
      style={{
        position: nested ? "relative" : "absolute",
        left: nested ? undefined : card.x,
        top: nested ? undefined : card.y,
        width: NOTE_WIDTH,
        minHeight: NOTE_MIN_HEIGHT,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        background: card.color,
        borderRadius: 4,
        boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
        outline: isSelected ? "2px solid #3b82f6" : "none",
        cursor: isEditing ? "text" : "grab",
      }}
    >
      {isEditing ? (
        <textarea
          autoFocus
          defaultValue={card.text}
          ref={(el) => {
            if (!el) return;
            el.style.height = "auto";
            el.style.height = `${el.scrollHeight}px`;
          }}
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = `${el.scrollHeight}px`;
          }}
          style={{
            width: "100%",
            boxSizing: "border-box",
            fontSize: NOTE_FONT_SIZE,
            padding: NOTE_PADDING,
            border: "none",
            outline: "2px solid #3b82f6",
            borderRadius: 4,
            resize: "none",
            background: "transparent",
            overflow: "hidden",
          }}
          onBlur={(e) => onCommitText(e.target.value)}
        />
      ) : (
        <div
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: NOTE_PADDING,
            fontSize: NOTE_FONT_SIZE,
            whiteSpace: "pre-wrap",
          }}
        >
          {card.text}
        </div>
      )}
    </div>
  );
}

function SwatchCardView({
  card,
  nested,
  isSelected,
  onPointerDownDrag,
  registerRef,
}: {
  card: SwatchCardType;
  nested: boolean;
  isSelected: boolean;
  onPointerDownDrag: (e: ReactPointerEvent<HTMLDivElement>) => void;
  registerRef: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div
      ref={registerRef}
      onPointerDown={onPointerDownDrag}
      style={{
        position: nested ? "relative" : "absolute",
        left: nested ? undefined : card.x,
        top: nested ? undefined : card.y,
        width: card.width,
        height: card.height,
        boxSizing: "border-box",
        background: card.hex,
        borderRadius: 4,
        boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
        outline: isSelected ? "2px solid #3b82f6" : "none",
        cursor: "grab",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#ffffff",
        fontSize: 13,
      }}
    >
      {card.hex}
    </div>
  );
}

function ImageCardView({
  card,
  nested,
  isSelected,
  onPointerDownDrag,
  registerRef,
}: {
  card: ImageCardType;
  nested: boolean;
  isSelected: boolean;
  onPointerDownDrag: (e: ReactPointerEvent<HTMLDivElement>) => void;
  registerRef: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div
      ref={registerRef}
      onPointerDown={onPointerDownDrag}
      style={{
        position: nested ? "relative" : "absolute",
        left: nested ? undefined : card.x,
        top: nested ? undefined : card.y,
        width: card.width,
        height: card.height,
        boxSizing: "border-box",
        borderRadius: 4,
        // 画像をwidth/height 100%で敷き詰めoverflow: hiddenにすることで、borderRadiusの丸みから画像の角がはみ出さないようにする。
        overflow: "hidden",
        boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
        outline: isSelected ? "2px solid #3b82f6" : "none",
        cursor: "grab",
      }}
    >
      <img
        src={card.src}
        alt={card.caption ?? ""}
        draggable={false}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: "block",
        }}
      />
    </div>
  );
}

// 子カードは絶対配置ではなく通常のブロック要素として並べているため、Column自身の高さはブラウザが自動計算し、それをuseSyncMeasuredHeightでcards配列に書き戻している。子がColumn(ネストしたColumn)の場合、renderChildは自分自身(ColumnCardView)を再度返すため、Column in Columnが何段ネストしていても同じ仕組みで描画できる。
function ColumnCardView({
  card,
  children,
  isSelected,
  editingTitle,
  nested,
  onSelectColumn,
  onStartEditTitle,
  onCommitTitle,
  onDragHeaderPointerDown,
  registerRef,
  onAddNote,
  renderChild,
  setCards,
}: {
  card: ColumnCardType;
  children: Card[];
  isSelected: boolean;
  editingTitle: boolean;
  nested: boolean;
  onSelectColumn: () => void;
  onStartEditTitle: () => void;
  onCommitTitle: (title: string) => void;
  onDragHeaderPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  registerRef: (el: HTMLDivElement | null) => void;
  onAddNote: () => void;
  renderChild: (child: Card) => ReactNode;
  setCards: Dispatch<SetStateAction<Card[]>>;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  useSyncMeasuredHeight(elRef, card.id, card.height, setCards);

  return (
    <div
      ref={(el) => {
        elRef.current = el;
        registerRef(el);
      }}
      style={{
        position: nested ? "relative" : "absolute",
        left: nested ? undefined : card.x,
        top: nested ? undefined : card.y,
        width: COLUMN_WIDTH,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        background: "#e5e7eb",
        borderRadius: 6,
        boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
        outline: isSelected ? "2px solid #3b82f6" : "none",
      }}
    >
      <div
        onPointerDown={onDragHeaderPointerDown}
        onClick={onSelectColumn}
        onDoubleClick={onStartEditTitle}
        style={{
          height: COLUMN_TITLE_HEIGHT,
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          padding: `0 ${COLUMN_PADDING}px`,
          fontWeight: "bold",
          fontSize: 14,
          cursor: "grab",
          borderBottom: "1px solid #cbd5e1",
        }}
      >
        {editingTitle ? (
          <input
            autoFocus
            defaultValue={card.title}
            // タイトルバーはドラッグハンドルを兼ねているため、input内でのクリックが
            // onDragHeaderPointerDown/onSelectColumnまでバブリングしないようにする。
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => onCommitTitle(e.target.value)}
            style={{
              width: "100%",
              fontSize: 14,
              fontWeight: "bold",
              border: "none",
              outline: "none",
              background: "transparent",
            }}
          />
        ) : (
          card.title
        )}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: COLUMN_ROW_GAP,
          padding: COLUMN_PADDING,
        }}
      >
        {children.map((child) => renderChild(child))}
        <button
          type="button"
          onClick={onAddNote}
          style={{
            border: "1px dashed #94a3b8",
            borderRadius: 4,
            background: "transparent",
            padding: "6px 0",
            fontSize: 13,
            color: "#475569",
            cursor: "pointer",
          }}
        >
          + Note
        </button>
      </div>
    </div>
  );
}

// strokes(カード原点からの相対座標の点列)をそのままSVGのpolylineとして描くだけ。カード自体のドラッグ移動は他のカードと同じhandleCardPointerDownの仕組みに乗せているため、strokesの相対座標はそのままでよい(カードのleft/topが動けば中身ごと動く)。
function DrawCardView({
  card,
  nested,
  isSelected,
  onPointerDownDrag,
  registerRef,
}: {
  card: DrawCardType;
  nested: boolean;
  isSelected: boolean;
  onPointerDownDrag: (e: ReactPointerEvent<HTMLDivElement>) => void;
  registerRef: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div
      ref={registerRef}
      onPointerDown={onPointerDownDrag}
      style={{
        position: nested ? "relative" : "absolute",
        left: nested ? undefined : card.x,
        top: nested ? undefined : card.y,
        width: card.width,
        height: card.height,
        outline: isSelected ? "2px solid #3b82f6" : "none",
        cursor: "grab",
      }}
    >
      <svg
        width={card.width}
        height={card.height}
        style={{ display: "block", overflow: "visible", pointerEvents: "none" }}
      >
        {card.strokes.map((stroke, i) => (
          <polyline
            key={i}
            points={stroke.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke={DRAW_STROKE_COLOR}
            strokeWidth={DRAW_STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
    </div>
  );
}

// cardRefsに登録済みの実DOM要素のgetBoundingClientRect()をそのまま使うため、Konva版のようにレイアウトを自前で再計算する必要が無い。excludeCardIdとその子孫は候補から除外し、自己ネスト・循環ネストを防ぐ。複数のColumnの領域が重なる場合は、最も面積が小さい＝最も内側のColumnを優先する。
function findDropTargetColumnAtClientPoint(
  clientX: number,
  clientY: number,
  cards: Card[],
  cardRefs: Map<string, HTMLDivElement>,
  excludeCardId: string,
): ColumnCardType | null {
  const excluded = new Set([
    excludeCardId,
    ...collectDescendantIds(excludeCardId, cards),
  ]);
  let best: { column: ColumnCardType; area: number } | null = null;
  for (const card of cards) {
    if (card.type !== "column" || excluded.has(card.id)) continue;
    const el = cardRefs.get(card.id);
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    )
      continue;
    const area = rect.width * rect.height;
    if (!best || area < best.area) best = { column: card, area };
  }
  return best?.column ?? null;
}

// canvas.tsx(Konva版)と同じ機能を、Konvaを使わずdiv + CSS transformだけで実装したもの。カードの状態(配列)とキャンバスの見た目(拡大率・位置)をすべてReactのuseStateで持つ設計はcanvas.tsxと同じだが、ドラッグ中の座標更新だけはstateを介さずrefのDOM要素を直接書き換える。
export function SpikeCanvasDom() {
  const containerRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  // カードごとの実DOM要素。ドラッグ中にReactのstateを介さず直接styleを書き換えるために保持する。トップレベルかColumnに何段ネストしているかを問わず、全カードがここに登録される(ネストしたカードもドラッグで取り出せるようにするため)。
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const previewPolylineRef = useRef<SVGPolylineElement>(null);
  const previewPointsRef = useRef<{ x: number; y: number }[]>([]);
  const activeDrawCardIdRef = useRef<string | null>(null);

  const [scale, setScale] = useState(1);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  // 初期値にloadCards(関数そのもの)を渡しているのは「遅延初期化」というReactの機能で、
  // 初回レンダリング時に1回だけloadCards()が呼ばれる。`useState(loadCards())`と書くと再レンダリングのたびにloadCards()が呼ばれてしまうため、関数を渡す書き方が正しい。
  const [cards, setCards] = useState<Card[]>(loadCards);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isDrawActive, setIsDrawActive] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
  }, [cards]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isDrawActive) {
        setIsDrawActive(false);
        activeDrawCardIdRef.current = null;
        return;
      }
      // テキスト編集中にBackspaceを押すと、文字を消したいだけなのにカードごと消えてしまうため、編集中は何もしない。
      if (editingId !== null) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        setCards((prev) => {
          // Columnを削除する時は中の子カードも一緒に削除する(エントリだけ消すと、子カードがトップレベルの孤児として復活して見えてしまうため)。
          const idsToRemove = new Set([
            selectedId,
            ...collectDescendantIds(selectedId, prev),
          ]);
          return prev
            .filter((c) => !idsToRemove.has(c.id))
            .map((c) =>
              c.type === "column"
                ? {
                    ...c,
                    cardIds: c.cardIds.filter((id) => !idsToRemove.has(id)),
                  }
                : c,
            );
        });
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // selectedId/editingId/isDrawActiveはhandleKeyDown内で参照する値なので依存配列に
    // 含める必要がある(含めないと登録時点の古い値を参照し続けるクロージャの罠になる)。
  }, [selectedId, editingId, isDrawActive]);

  const toWorldPos = (clientX: number, clientY: number) => {
    const rect = containerRef.current!.getBoundingClientRect();
    return {
      x: (clientX - rect.left - stagePos.x) / scale,
      y: (clientY - rect.top - stagePos.y) / scale,
    };
  };

  // マウスカーソルの位置を基準にズームする(カーソル直下の座標がズーム前後で画面上の同じ位置に留まるように、拡大率と同時にstagePosも再計算する)。
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault(); // ブラウザ標準のページスクロールを止める
    const rect = containerRef.current!.getBoundingClientRect();
    const pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const oldScale = scale;
    const mousePointTo = {
      x: (pointer.x - stagePos.x) / oldScale,
      y: (pointer.y - stagePos.y) / oldScale,
    };
    const newScale = e.deltaY > 0 ? oldScale / ZOOM_STEP : oldScale * ZOOM_STEP;
    setScale(newScale);
    setStagePos({
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    });
  };

  // e.targetがcurrentTarget(このdiv自身)と一致する時だけ処理するのは、子要素からのイベントを親のハンドラが誤って処理してしまうのを防ぐガード。Konva版はStage/Groupそれぞれにdraggableを設定してこの区別をライブラリ任せにしているが、自前実装では「背景用」「カード用」でpointerdownハンドラ自体を分けることで同じ区別を実現している。
  const handleBackgroundPointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (e.target !== e.currentTarget) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const origin = stagePos;
    // クリックなのかドラッグ(パン)なのかを、実際にpointermoveが1回でも起きたかで判定する。
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      moved = true;
      const next = {
        x: origin.x + (ev.clientX - startX),
        y: origin.y + (ev.clientY - startY),
      };
      // ドラッグ中はsetStateを呼ばず、worldRefのtransformを直接書き換える(pointermoveのたびに再レンダリングが走るのを避けるための最適化)。
      if (worldRef.current) {
        worldRef.current.style.transform = `translate(${next.x}px, ${next.y}px) scale(${scale})`;
      }
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (moved) {
        setStagePos({
          x: origin.x + (ev.clientX - startX),
          y: origin.y + (ev.clientY - startY),
        });
      } else {
        setSelectedId(null);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // 読み込み自体はすぐ失効してよいBlob URLで行う(Imageへdrawした直後にrevokeするだけ)。
  // localStorageに保存するdata URL化はcreateImageCard内で縮小後サイズに対して行う(元画像そのままdata URL化するとQuotaExceededErrorに繋がりやすいため)。
  const addImageCardAt = (file: File, center: { x: number; y: number }) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      // createImageCardは縮小後の幅・高さを返すため、先に(0, 0)で作ってからその幅・高さでcenterが中心に来るx, yを計算し直す。
      const placeholder = createImageCard(0, 0, img);
      const newCard = {
        ...placeholder,
        x: center.x - placeholder.width / 2,
        y: center.y - placeholder.height / 2,
      };
      setCards((prev) => insertCardAtPoint(prev, newCard, center));
      setSelectedId(newCard.id);
    };
    img.src = objectUrl;
  };

  const handlePickImageFile = (file: File) => {
    addImageCardAt(
      file,
      toWorldPos(window.innerWidth / 2, window.innerHeight / 2),
    );
  };

  const handleContainerDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    const isCardDrag = e.dataTransfer.types.includes(CARD_TYPE_DRAG_MIME);
    const isFileDrag = e.dataTransfer.types.includes("Files");
    if (!isCardDrag && !isFileDrag) return;
    e.preventDefault(); // これを呼ばないとdropイベントが発火しない(HTML5 D&Dの仕様)
    e.dataTransfer.dropEffect = "copy";
  };

  const handleContainerDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.files.length > 0) {
      e.preventDefault();
      const pos = toWorldPos(e.clientX, e.clientY);
      // 複数枚まとめてドロップされても完全に重ならないよう、少しずつずらして配置する。
      Array.from(e.dataTransfer.files)
        .filter((file) => file.type.startsWith("image/"))
        .forEach((file, i) => {
          addImageCardAt(file, { x: pos.x + i * 24, y: pos.y + i * 24 });
        });
      return;
    }

    const cardType = e.dataTransfer.getData(CARD_TYPE_DRAG_MIME);
    if (cardType !== "note" && cardType !== "column") return;
    e.preventDefault();
    const pos = toWorldPos(e.clientX, e.clientY);
    const newCard =
      cardType === "note"
        ? createNoteCard(pos.x, pos.y)
        : createColumnCard(pos.x, pos.y);
    setCards((prev) => insertCardAtPoint(prev, newCard, pos));
    setSelectedId(newCard.id);
  };

  const handleToggleDraw = () => {
    setIsDrawActive((prev) => {
      const next = !prev;
      if (!next) activeDrawCardIdRef.current = null;
      return next;
    });
  };

  const handleAddNoteToColumn = (columnId: string) => {
    const newNote = createNoteCard();
    setCards((prev) => [
      ...prev.map((c) =>
        c.id === columnId && c.type === "column"
          ? { ...c, cardIds: [...c.cardIds, newNote.id] }
          : c,
      ),
      newNote,
    ]);
  };

  const handleDrawPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const start = toWorldPos(e.clientX, e.clientY);
    previewPointsRef.current = [start];
    updatePreviewPolyline();

    const onMove = (ev: PointerEvent) => {
      previewPointsRef.current.push(toWorldPos(ev.clientX, ev.clientY));
      updatePreviewPolyline();
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      commitStroke(previewPointsRef.current);
      previewPointsRef.current = [];
      updatePreviewPolyline();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const updatePreviewPolyline = () => {
    const el = previewPolylineRef.current;
    if (!el) return;
    el.setAttribute(
      "points",
      previewPointsRef.current.map((p) => `${p.x},${p.y}`).join(" "),
    );
  };

  const commitStroke = (worldPoints: { x: number; y: number }[]) => {
    // firstPointのundefinedチェックは、下のlengthガードにより実行時には必ず通過するが、TypeScriptの配列アクセスは長さチェックと連動して絞り込まれないため明示している。
    const [firstPoint] = worldPoints;
    if (!firstPoint || worldPoints.length < 2) return;
    setCards((prev) => {
      const activeId = activeDrawCardIdRef.current;
      const existing = activeId
        ? prev.find(
            (c): c is DrawCardType => c.id === activeId && c.type === "draw",
          )
        : undefined;
      if (existing) {
        const updated = addStrokeToDrawCard(existing, worldPoints);
        return prev.map((c) => (c.id === updated.id ? updated : c));
      }
      const created = addStrokeToDrawCard(
        createDrawCard(firstPoint.x, firstPoint.y) as DrawCardType,
        worldPoints,
      );
      activeDrawCardIdRef.current = created.id;
      return [...prev, created];
    });
  };

  // 素朴にpointermoveのたびにsetCardsを呼ぶと、1秒間に何十回もReactの再レンダリングが走ってしまう。それを避けるため、ドラッグ中はcardRefsから取得した実DOM要素のstyle.left/topを直接書き換え、pointerupで指を離した瞬間に初めてsetCardsでReactのstateへ反映する。note/swatch/column(タイトルバー)/draw/imageの全カード種別、トップレベル/ネスト問わず共通で使う。
  const handleCardPointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    card: Card,
  ) => {
    if (editingId === card.id) return; // テキスト編集中のtextarea/input操作はドラッグ扱いにしない
    setSelectedId(card.id);

    const startX = e.clientX;
    const startY = e.clientY;
    // ネストされたカードのcard.x/card.yはColumn内では使われない値のため、そのままドラッグのorigin(基準位置)にはできない。実際に動いた瞬間(最初のonMove)に、その時点の画面上の実位置から逆算したワールド座標でColumnの子から抜けさせ(下記のpromoted分岐)、以降は元からトップレベルだったカードと同じ扱いで追跡する。単純なクリックの場合はこの昇格処理自体が走らないため、意図せずColumnの外に出ることはない。
    let origin = { x: card.x, y: card.y };
    let el = cardRefs.current.get(card.id);
    let promoted = !columnChildIds.has(card.id);
    let moved = false;
    let highlightedTargetId: string | null = null;
    const clearHighlight = () => {
      if (!highlightedTargetId) return;
      const targetEl = cardRefs.current.get(highlightedTargetId);
      if (targetEl) {
        targetEl.style.outline =
          selectedId === highlightedTargetId ? "2px solid #3b82f6" : "none";
      }
      highlightedTargetId = null;
    };

    const onMove = (ev: PointerEvent) => {
      if (!promoted) {
        // 昇格前の実際の画面位置(Columnのflexレイアウトが決めた位置)をワールド座標に変換し、その位置を保ったままトップレベルのカードとして確定する(視覚的なジャンプを防ぐ)。setCardsをflushSyncで包んで同期的に完了させないと、直後のcardRefs.current.get(card.id)がまだColumn内の(まもなくアンマウントされる)DOM要素を指したままになってしまう。
        const currentEl = cardRefs.current.get(card.id);
        const rect = currentEl?.getBoundingClientRect();
        origin = rect ? toWorldPos(rect.left, rect.top) : origin;
        flushSync(() => {
          setCards((prev) => moveCardTo(prev, card.id, { worldPos: origin }));
        });
        el = cardRefs.current.get(card.id);
        promoted = true;
      }
      moved = true;
      const dx = (ev.clientX - startX) / scale;
      const dy = (ev.clientY - startY) / scale;
      if (el) {
        el.style.left = `${origin.x + dx}px`;
        el.style.top = `${origin.y + dy}px`;
      }
      const target = findDropTargetColumnAtClientPoint(
        ev.clientX,
        ev.clientY,
        cards,
        cardRefs.current,
        card.id,
      );
      if (target?.id !== highlightedTargetId) {
        clearHighlight();
        highlightedTargetId = target?.id ?? null;
        if (highlightedTargetId) {
          const targetEl = cardRefs.current.get(highlightedTargetId);
          if (targetEl) targetEl.style.outline = "2px solid #22c55e";
        }
      }
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      clearHighlight();
      if (moved) {
        const dx = (ev.clientX - startX) / scale;
        const dy = (ev.clientY - startY) / scale;
        const worldPos = { x: origin.x + dx, y: origin.y + dy };
        setCards((prev) => {
          const target = findDropTargetColumnAtClientPoint(
            ev.clientX,
            ev.clientY,
            prev,
            cardRefs.current,
            card.id,
          );
          return moveCardTo(
            prev,
            card.id,
            target ? { columnId: target.id } : { worldPos },
          );
        });
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const columnChildIds = getColumnChildIds(cards);

  // トップレベル(nested=false、絶対配置)とColumn内の子カード(nested=true、flexフローに従う通常要素)の両方から呼べる共通関数にすることで、Columnの中でrenderCardDomを再帰呼び出しし、Column in Columnの無制限ネストに対応している。nestedの値に関わらずonPointerDownDrag/registerRefは常に有効にしている(見た目の切り替えだけがnestedの役割で、ドラッグの可否には影響しない)。
  const renderCardDom = (card: Card, nested: boolean): ReactNode => {
    const registerRef = (el: HTMLDivElement | null) => {
      if (el) cardRefs.current.set(card.id, el);
      else cardRefs.current.delete(card.id);
    };
    const onPointerDownDrag = (e: ReactPointerEvent<HTMLDivElement>) =>
      handleCardPointerDown(e, card);

    if (card.type === "note") {
      return (
        <NoteCardView
          key={card.id}
          card={card}
          nested={nested}
          isSelected={selectedId === card.id}
          isEditing={editingId === card.id}
          onStartEdit={() => setEditingId(card.id)}
          onCommitText={(text) => {
            setCards((prev) =>
              prev.map((c) => (c.id === card.id ? { ...c, text } : c)),
            );
            setEditingId(null);
          }}
          onPointerDownDrag={onPointerDownDrag}
          registerRef={registerRef}
          setCards={setCards}
        />
      );
    }

    if (card.type === "swatch") {
      return (
        <SwatchCardView
          key={card.id}
          card={card}
          nested={nested}
          isSelected={selectedId === card.id}
          onPointerDownDrag={onPointerDownDrag}
          registerRef={registerRef}
        />
      );
    }

    if (card.type === "image") {
      return (
        <ImageCardView
          key={card.id}
          card={card}
          nested={nested}
          isSelected={selectedId === card.id}
          onPointerDownDrag={onPointerDownDrag}
          registerRef={registerRef}
        />
      );
    }

    if (card.type === "draw") {
      return (
        <DrawCardView
          key={card.id}
          card={card}
          nested={nested}
          isSelected={selectedId === card.id}
          onPointerDownDrag={onPointerDownDrag}
          registerRef={registerRef}
        />
      );
    }

    if (card.type === "column") {
      const children = card.cardIds
        .map((id) => cards.find((c) => c.id === id))
        .filter((c): c is Card => !!c);
      return (
        <ColumnCardView
          key={card.id}
          card={card}
          children={children}
          nested={nested}
          isSelected={selectedId === card.id}
          editingTitle={editingId === card.id}
          onSelectColumn={() => setSelectedId(card.id)}
          onStartEditTitle={() => setEditingId(card.id)}
          onCommitTitle={(title) => {
            setCards((prev) =>
              prev.map((c) => (c.id === card.id ? { ...c, title } : c)),
            );
            setEditingId(null);
          }}
          onDragHeaderPointerDown={onPointerDownDrag}
          registerRef={registerRef}
          onAddNote={() => handleAddNoteToColumn(card.id)}
          renderChild={(child) => renderCardDom(child, true)}
          setCards={setCards}
        />
      );
    }

    return null;
  };

  return (
    <>
      <Sidebar
        isDrawActive={isDrawActive}
        onToggleDraw={handleToggleDraw}
        onPickImageFile={handlePickImageFile}
      />
      {/* containerRef: Konva版のStageに相当する、画面いっぱいの背景。touchAction: "none"はタッチ操作時にブラウザ標準のスクロール/ピンチズームが自前のパン/ズーム実装と競合しないようにするため。 */}
      <div
        ref={containerRef}
        onWheel={handleWheel}
        onPointerDown={isDrawActive ? undefined : handleBackgroundPointerDown}
        onDragOver={handleContainerDragOver}
        onDrop={handleContainerDrop}
        style={{
          position: "fixed",
          inset: 0,
          overflow: "hidden",
          touchAction: "none",
          background: "#f5f5f5",
          cursor: isDrawActive ? "crosshair" : undefined,
        }}
      >
        {/* worldRef: Konva版のLayer/Group群に相当する、パン・ズームのtransformを一括で適用する層。transformOrigin: "0 0"はスケール変換の基準点を左上に固定するため(デフォルトの中央基準だとパン位置の計算が複雑になる)。 */}
        <div
          ref={worldRef}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            transformOrigin: "0 0",
            transform: `translate(${stagePos.x}px, ${stagePos.y}px) scale(${scale})`,
          }}
        >
          {cards.map((card) =>
            columnChildIds.has(card.id) ? null : renderCardDom(card, false),
          )}

          <svg
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              overflow: "visible",
              pointerEvents: "none",
            }}
          >
            <polyline
              ref={previewPolylineRef}
              fill="none"
              stroke={DRAW_STROKE_COLOR}
              strokeWidth={DRAW_STROKE_WIDTH}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        {/* ペンモード中だけキャンバス全面に重ねる透明オーバーレイ。これより下(worldRef)へのpointerdownを奪うことで、カード選択・ドラッグ・背景パンが同時に発生しないようにしている。 */}
        {isDrawActive && (
          <div
            onPointerDown={handleDrawPointerDown}
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 5,
              cursor: "crosshair",
            }}
          />
        )}
      </div>
    </>
  );
}
