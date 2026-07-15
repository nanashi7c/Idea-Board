// localStorage/pointer event等ブラウザAPIに依存するため、Client Componentとして実行する。
"use client";

import { useEffect, useRef, useState } from "react";
import type {
  Dispatch,
  PointerEvent as ReactPointerEvent,
  RefObject,
  SetStateAction,
} from "react";
// packages/sharedで定義したTypeScript型をそのままフロントでも使う。
// Card: カード1枚分の型(note/image/swatch/column/drawのunion型)
import type { Card } from "shared";
// カード一覧の初期値・localStorage永続化ロジック。Konva版(canvas.tsx)と
// 同じボードデータを共有できるよう、レンダラーに依存しない部分はboard-storage.tsに切り出している。
import {
  STORAGE_KEY,
  createNoteCard,
  createColumnCard,
  createDrawCard,
  addStrokeToDrawCard,
  getColumnChildIds,
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
} from "./board-storage";
import { Sidebar, CARD_TYPE_DRAG_MIME } from "./toolbar";

// 1回のホイール操作あたりの拡大/縮小率。Konva版と同じ値。
const ZOOM_STEP = 1.05;

type NoteCard = Extract<Card, { type: "note" }>;
type ColumnCardType = Extract<Card, { type: "column" }>;
type DrawCardType = Extract<Card, { type: "draw" }>;

// Note/Columnはコンテンツ量に応じて高さが変わる（Noteはテキストの表示行数、Columnは
// 中のNote数）。固定値をstyleに書く代わりに、実際にDOMへレンダリングされた高さを
// ResizeObserverで測定し、cards配列のheightへ書き戻すためのフック。
// 「測定→setCards→再描画→再測定」が無限ループにならないよう、直前に測定した高さは
// refで持ち、変化が無ければsetCardsを呼ばない。
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

// Noteカード1枚分の描画。トップレベル（キャンバス上に直接ドラッグ配置されたNote）と、
// Column内の子Note（縦リストの中の1項目）の両方から呼ばれる。
// onPointerDownDrag/registerRefが指定されている時だけ「絶対配置＋ドラッグ可能」になり、
// 未指定（Column内）の時はColumn側のflexレイアウトに従う「通常のブロック要素」として並ぶ。
function NoteCardView({
  card,
  isSelected,
  isEditing,
  onSelect,
  onStartEdit,
  onCommitText,
  onPointerDownDrag,
  registerRef,
  setCards,
}: {
  card: NoteCard;
  isSelected: boolean;
  isEditing: boolean;
  onSelect: () => void;
  onStartEdit: () => void;
  onCommitText: (text: string) => void;
  onPointerDownDrag?: (e: ReactPointerEvent<HTMLDivElement>) => void;
  registerRef?: (el: HTMLDivElement | null) => void;
  setCards: Dispatch<SetStateAction<Card[]>>;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  // 表示行数(折り返し含む)に応じて高さが伸縮するため、実測値をcards配列に同期する。
  useSyncMeasuredHeight(elRef, card.id, card.height, setCards);

  const draggable = onPointerDownDrag !== undefined;

  return (
    <div
      ref={(el) => {
        elRef.current = el;
        registerRef?.(el);
      }}
      onPointerDown={onPointerDownDrag}
      onClick={draggable ? undefined : onSelect}
      onDoubleClick={onStartEdit}
      style={{
        position: draggable ? "absolute" : "relative",
        left: draggable ? card.x : undefined,
        top: draggable ? card.y : undefined,
        width: NOTE_WIDTH,
        minHeight: NOTE_MIN_HEIGHT,
        boxSizing: "border-box",
        // 横長カード内でテキストを縦センタリングするため、1個だけのflexアイテムを
        // 縦方向中央に配置する。
        display: "flex",
        alignItems: "center",
        background: card.color,
        borderRadius: 4,
        boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
        outline: isSelected ? "2px solid #3b82f6" : "none",
        cursor: isEditing ? "text" : draggable ? "grab" : "pointer",
      }}
    >
      {isEditing ? (
        <textarea
          autoFocus
          defaultValue={card.text}
          // 初回マウント時に、既存テキストの行数に合わせて高さを合わせておく
          // (auto-grow textareaの定番手順: heightをautoに戻してからscrollHeightを読む)。
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

// Columnカード1枚分の描画。タイトルバー(ドラッグハンドル兼ダブルクリックで編集)と、
// 縦に並んだ子Noteのリスト、末尾の「+ Note」ボタンで構成する。
// 子Noteは絶対配置ではなく通常のブロック要素として並べているため、Column自身の高さは
// (タイトル＋子Noteの合計＋余白)に応じてブラウザが自動計算し、それをuseSyncMeasuredHeightで
// cards配列に書き戻している。
function ColumnCardView({
  card,
  children,
  isSelected,
  editingTitle,
  editingNoteId,
  selectedId,
  onSelectColumn,
  onStartEditTitle,
  onCommitTitle,
  onDragHeaderPointerDown,
  registerRef,
  onAddNote,
  onSelectNote,
  onStartEditNote,
  onCommitNoteText,
  setCards,
}: {
  card: ColumnCardType;
  children: NoteCard[];
  isSelected: boolean;
  editingTitle: boolean;
  editingNoteId: string | null;
  selectedId: string | null;
  onSelectColumn: () => void;
  onStartEditTitle: () => void;
  onCommitTitle: (title: string) => void;
  onDragHeaderPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  registerRef: (el: HTMLDivElement | null) => void;
  onAddNote: () => void;
  onSelectNote: (id: string) => void;
  onStartEditNote: (id: string) => void;
  onCommitNoteText: (id: string, text: string) => void;
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
        position: "absolute",
        left: card.x,
        top: card.y,
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
        {children.map((note) => (
          <NoteCardView
            key={note.id}
            card={note}
            isSelected={selectedId === note.id}
            isEditing={editingNoteId === note.id}
            onSelect={() => onSelectNote(note.id)}
            onStartEdit={() => onStartEditNote(note.id)}
            onCommitText={(text) => onCommitNoteText(note.id, text)}
            setCards={setCards}
          />
        ))}
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

// Drawカード1枚分の描画。strokes(カード原点からの相対座標の点列)をそのままSVGの
// polylineとして描くだけ。カード自体のドラッグ移動は他のカードと同じ
// handleCardPointerDownの仕組みに乗せているため、strokesの相対座標はそのままで良い
// (カードのleft/topが動けば、中身のSVGごと一緒に動く)。
function DrawCardView({
  card,
  isSelected,
  onPointerDownDrag,
  registerRef,
}: {
  card: DrawCardType;
  isSelected: boolean;
  onPointerDownDrag: (e: ReactPointerEvent<HTMLDivElement>) => void;
  registerRef: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div
      ref={registerRef}
      onPointerDown={onPointerDownDrag}
      style={{
        position: "absolute",
        left: card.x,
        top: card.y,
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

// canvas.tsx(Konva版)と同じ機能を、Konvaを使わずdiv + CSS transformだけで実装したもの。
// KONVA_VS_DOM.mdで比較した「自前実装(DOM)の場合」のコード例を、実際に動く形にしたもの。
// カードの状態(配列)とキャンバスの見た目(拡大率・位置)をすべてReactのuseStateで持つ設計は
// canvas.tsxと同じだが、ドラッグ中の座標更新だけはstateを介さずrefのDOM要素を直接書き換える
// (理由は各ハンドラのコメント、およびKONVA_VS_DOM.md「2. ドラッグ」参照)。
export function SpikeCanvasDom() {
  // 背景(パン・ズームの基準)となる、画面いっぱいのコンテナ要素。
  const containerRef = useRef<HTMLDivElement>(null);
  // パン・ズームのtransformを適用する、カードたちの親要素(Konvaの Stage 相当)。
  const worldRef = useRef<HTMLDivElement>(null);
  // カードごとの実DOM要素。ドラッグ中にReactのstateを介さず直接styleを書き換えるために保持する。
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  // Draw用: 描画中のストロークをライブプレビューするpolyline要素。
  const previewPolylineRef = useRef<SVGPolylineElement>(null);
  // Draw用: 描画中のストロークの点列(ワールド座標)。pointermoveのたびにここへ追記し、
  // Reactのstateは介さずpreviewPolylineRefのpoints属性を直接書き換える
  // (カードドラッグの最適化と同じ理由。commit時に初めてsetCardsする)。
  const previewPointsRef = useRef<{ x: number; y: number }[]>([]);
  // Draw用: ペンモード中に作成中のDrawカードのid。ペンモードを抜けるまでは
  // 複数回のドラッグ(ストローク)がすべて同じ1枚のDrawカードに追記される。
  const activeDrawCardIdRef = useRef<string | null>(null);

  // キャンバス全体の拡大率(ズーム)。1が等倍。
  const [scale, setScale] = useState(1);
  // キャンバス全体の表示位置(パン)。worldRefのtransformに反映する値をstateとして保持する。
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  // カード一覧そのもの。ここが「ボードの中身」の実体で、Undo・保存・整列など、
  // 今後追加する機能はすべてこの配列をどう更新するかという話になる。
  // 初期値にloadCards(関数そのもの)を渡しているのは「遅延初期化」というReactの機能で、
  // 初回レンダリング時に1回だけloadCards()が呼ばれる。もし`useState(loadCards())`と書くと
  // 再レンダリングのたびにloadCards()が呼ばれてしまうため、関数を渡す書き方が正しい。
  const [cards, setCards] = useState<Card[]>(loadCards);
  // 現在選択中のカードのID(枠線をハイライトするために使う)。何も選んでいなければnull。
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 現在テキスト編集中のカードのID。Noteならテキスト、Columnならタイトルの編集を表す。
  // editingIdがセットされている間だけ、該当箇所をdivの代わりに<textarea>/<input>にすり替えて表示する。
  const [editingId, setEditingId] = useState<string | null>(null);
  // Drawアイコンをオンにしている間(ペンモード)かどうか。trueの間はキャンバス全体が
  // ドラッグ描画用のオーバーレイに覆われ、パン・カード選択・カードドラッグは無効になる。
  const [isDrawActive, setIsDrawActive] = useState(false);

  // cards配列が変わるたびにlocalStorageへ保存する副作用。
  // 依存配列に[cards]を指定しているので、cardsが変化した時だけ実行される。
  // 「保存ボタン」を作らず、状態が変わったら自動で保存する(自動保存)方式にしている。
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
  }, [cards]);

  // キーボードのDelete/Backspaceで選択中のカードを削除、Escapeでペンモードを終了するための副作用。
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isDrawActive) {
        setIsDrawActive(false);
        activeDrawCardIdRef.current = null;
        return;
      }
      // テキスト編集中(<textarea>/<input>にフォーカスがある状態)にBackspaceを押すと
      // 文字を消したいだけなのにカードごと消えてしまうため、編集中は何もしない。
      if (editingId !== null) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        setCards((prev) => {
          const target = prev.find((c) => c.id === selectedId);
          // Columnを削除する時は、中の子Noteも一緒に削除する
          // (Columnのcards配列上のエントリだけ消すと、子Noteがトップレベルの孤児として
          // 復活して見えてしまうため)。
          const idsToRemove = new Set([selectedId]);
          if (target?.type === "column") {
            for (const childId of target.cardIds) idsToRemove.add(childId);
          }
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
    // selectedId/editingId/isDrawActiveはhandleKeyDownの中で参照している値なので、
    // 依存配列に含める必要がある(含めないと、登録時点の古い値を参照し続けてしまう
    // ＝いわゆる「クロージャの罠」)。
  }, [selectedId, editingId, isDrawActive]);

  // スクリーン座標(clientX/Y)を、パン・ズームを差し引いたワールド座標に変換する。
  // Konvaのstage.getRelativePointerPosition()に相当する逆変換を自前で書く必要がある部分
  // (KONVA_VS_DOM.md「1. 座標変換」参照)。
  const toWorldPos = (clientX: number, clientY: number) => {
    const rect = containerRef.current!.getBoundingClientRect();
    return {
      x: (clientX - rect.left - stagePos.x) / scale,
      y: (clientY - rect.top - stagePos.y) / scale,
    };
  };

  // マウスホイールでのズーム処理。マウスカーソルの位置を基準にズームする
  // (カーソル直下の座標がズーム前後で画面上の同じ位置に留まるように、拡大率と
  // 同時にstagePosも再計算する)。
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    // ブラウザ標準のページスクロールが同時に起きないようにする。
    e.preventDefault();
    const rect = containerRef.current!.getBoundingClientRect();
    // ポインタ位置(コンテナ基準・拡大率やパンの影響を受けない画面座標)を取得する。
    const pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const oldScale = scale;
    // ポインタ位置を、現在の拡大率・パン位置を差し引いた「ワールド座標」に変換する。
    const mousePointTo = {
      x: (pointer.x - stagePos.x) / oldScale,
      y: (pointer.y - stagePos.y) / oldScale,
    };
    // deltaYが正(下スクロール)なら縮小、負(上スクロール)なら拡大。
    const newScale = e.deltaY > 0 ? oldScale / ZOOM_STEP : oldScale * ZOOM_STEP;
    setScale(newScale);
    // ワールド座標上の同じ点が、新しい拡大率でも同じ画面座標(pointer)に来るように
    // stagePosを再計算する。
    setStagePos({
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    });
  };

  // 背景(カード以外の部分)でのpointerdown。パン開始、または(動きが無ければ)選択解除に使う。
  // e.targetがcurrentTarget(このdiv自身)と一致する時だけ処理するのは、BUG_NOTES.mdで踏んだ
  // 「子要素からのイベントを親のハンドラが誤って処理してしまう」バグと同種の対策。
  // Konva版はStage/Groupそれぞれにdraggableを設定してこの区別をライブラリ任せにしているが、
  // 自前実装では「背景用」「カード用」でpointerdownハンドラ自体を分けることで同じ区別を実現している。
  const handleBackgroundPointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (e.target !== e.currentTarget) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const origin = stagePos;
    // クリックなのかドラッグ(パン)なのかを、実際にpointermoveが1回でも起きたかで判定するフラグ。
    // 背景クリック=選択解除、背景ドラッグ=パン、という2つの操作を
    // 同じpointerdown起点のハンドラでまとめて扱うために必要。
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      moved = true;
      const next = {
        x: origin.x + (ev.clientX - startX),
        y: origin.y + (ev.clientY - startY),
      };
      // ドラッグ中はsetStateを呼ばず、worldRefのtransformを直接書き換える。
      // pointermoveのたびに再レンダリングが走るのを避けるための最適化
      // (KONVA_VS_DOM.md「2. ドラッグ」参照。Konvaは内部でこれと同等のことを標準機能として行っている)。
      if (worldRef.current) {
        worldRef.current.style.transform = `translate(${next.x}px, ${next.y}px) scale(${scale})`;
      }
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (moved) {
        // ドラッグ(パン)として終わった場合だけ、最終位置をstateへ確定する。
        // ドラッグ中は直接DOM操作のみで済ませ、pointerupの1回だけsetStateする方式
        // (Konva版のonDragEndと役割は同じ)。
        setStagePos({
          x: origin.x + (ev.clientX - startX),
          y: origin.y + (ev.clientY - startY),
        });
      } else {
        // 動きが無かった=単純なクリックとみなし、選択解除する。
        setSelectedId(null);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const handleBackgroundDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return; // カード自体のダブルクリックは各カード側で処理
    // 背景をダブルクリックしたら、その位置に新しいNoteカードを作る(カード作成のUI)。
    const pos = toWorldPos(e.clientX, e.clientY);
    const newCard = createNoteCard(pos.x, pos.y);
    setCards((prev) => [...prev, newCard]);
    setSelectedId(newCard.id);
  };

  // サイドバーのNote/Columnアイコンをキャンバス上にドラッグ&ドロップした時の受け皿。
  // dataTransferにCARD_TYPE_DRAG_MIMEが載っている(=サイドバー発のドラッグである)時だけ
  // ドロップを許可する(通常のテキストドラッグ等と誤反応しないようにするため)。
  const handleContainerDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes(CARD_TYPE_DRAG_MIME)) return;
    e.preventDefault(); // これを呼ばないとdropイベントが発火しない(HTML5 D&Dの仕様)
    e.dataTransfer.dropEffect = "copy";
  };

  const handleContainerDrop = (e: React.DragEvent<HTMLDivElement>) => {
    const cardType = e.dataTransfer.getData(CARD_TYPE_DRAG_MIME);
    if (cardType !== "note" && cardType !== "column") return;
    e.preventDefault();
    const pos = toWorldPos(e.clientX, e.clientY);
    const newCard =
      cardType === "note"
        ? createNoteCard(pos.x, pos.y)
        : createColumnCard(pos.x, pos.y);
    setCards((prev) => [...prev, newCard]);
    setSelectedId(newCard.id);
  };

  // Drawアイコンのオン/オフ切り替え。オフにする瞬間、作成中だったDrawカードへの
  // 参照(activeDrawCardIdRef)もリセットする(再度オンにした時は新しい1枚として扱う)。
  const handleToggleDraw = () => {
    setIsDrawActive((prev) => {
      const next = !prev;
      if (!next) activeDrawCardIdRef.current = null;
      return next;
    });
  };

  // Column内の「+ Note」ボタン。新しいNoteをcards配列に追加すると同時に、
  // そのidを対象Columnのcardsに登録する。子Noteのx, yはColumn側のflexレイアウトが
  // 面倒を見るため使わない(0のまま)。
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

  // ペンモード中、キャンバス全面を覆う透明オーバーレイでのpointerdown。
  // ここから1本のストロークが始まる。pointermoveのたびにReactのstateは介さず
  // previewPolylineRefのpoints属性を直接書き換えて描画し(カードドラッグと同じ最適化)、
  // pointerupで初めてstrokeをDrawカードとしてcards配列にコミットする。
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

  // 描き終えたストローク(ワールド座標の点列)を、ペンモード中に作成中のDrawカードへ追記する。
  // まだ1本もストロークを描いていなければ(activeDrawCardIdRef.current === null)、
  // この1本目のストロークから新しいDrawカードを作る。
  const commitStroke = (worldPoints: { x: number; y: number }[]) => {
    // 動きの無いクリックはストロークとして扱わない。firstPointのundefinedチェックは
    // このガードにより実行時には必ず通過するが、TypeScriptの配列アクセスは
    // 長さチェックと連動して絞り込まれないため、明示チェックで型エラーを解消する。
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

  // カード単体のドラッグ移動。KONVA_VS_DOM.md「2. ドラッグ」で比較した通り、
  // 素朴にpointermoveのたびにsetCardsを呼ぶと、1秒間に何十回もReactの再レンダリング・
  // cards.map(...)での全カード分の要素再生成・reconcileが走ってしまう。
  // それを避けるため、ドラッグ中はcardRefsから取得した実DOM要素のstyle.left/topを直接書き換え、
  // pointerupで指を離した瞬間に初めてsetCardsでReactのstateへ反映する。
  // note/swatch/column(タイトルバー)/drawの全カード種別で共通して使う。
  const handleCardPointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    card: Card,
  ) => {
    if (editingId === card.id) return; // テキスト編集中のtextarea/input操作はドラッグ扱いにしない
    setSelectedId(card.id);

    const startX = e.clientX;
    const startY = e.clientY;
    const origin = { x: card.x, y: card.y };
    const el = cardRefs.current.get(card.id);
    // 実際に動いたかどうか。動いていなければ「クリックによる選択」だけで終わらせる。
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      moved = true;
      // スクリーン座標の移動量をscaleで割り、ワールド座標系での移動量に変換する。
      // ズームしている状態だと、画面上の1pxの移動がワールド座標では1px未満/以上になるため。
      const dx = (ev.clientX - startX) / scale;
      const dy = (ev.clientY - startY) / scale;
      if (el) {
        el.style.left = `${origin.x + dx}px`;
        el.style.top = `${origin.y + dy}px`;
      }
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (moved) {
        // ドラッグ終了時、動いた先の座標をcards配列に反映する。
        // 対象カードのみをmapで新しいオブジェクトに差し替え、他のカードはそのまま残す
        // (Reactのstateを直接書き換えないための定型パターン)。
        const dx = (ev.clientX - startX) / scale;
        const dy = (ev.clientY - startY) / scale;
        setCards((prev) =>
          prev.map((c) =>
            c.id === card.id ? { ...c, x: origin.x + dx, y: origin.y + dy } : c,
          ),
        );
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // あるColumnの中に入っている(＝トップレベルでは描画しない)Noteのid一覧。
  const columnChildIds = getColumnChildIds(cards);

  return (
    <>
      <Sidebar isDrawActive={isDrawActive} onToggleDraw={handleToggleDraw} />
      {/* containerRef: Konva版のStageに相当する、画面いっぱいの背景。
          position: fixed + inset: 0で常にビューポート全体を覆い、overflow: hiddenで
          ワールド側(worldRef)がこの範囲外にはみ出してもスクロールバーが出ないようにしている。
          touchAction: "none"は、タッチ操作時にブラウザ標準のスクロール/ピンチズームが
          自前のパン/ズーム実装と competing しないようにするため。 */}
      <div
        ref={containerRef}
        onWheel={handleWheel}
        onPointerDown={isDrawActive ? undefined : handleBackgroundPointerDown}
        onDoubleClick={isDrawActive ? undefined : handleBackgroundDoubleClick}
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
        {/* worldRef: Konva版のLayer/Group群に相当する、パン・ズームのtransformを一括で
            適用する層。カードは全てこの中に絶対配置(left/top)で置かれ、親のtransformだけで
            画面上の位置・拡大率が決まる。transformOrigin: "0 0"は、スケール変換の基準点を
            左上に固定するため(デフォルトの中央基準だと、パン位置の計算が複雑になる)。 */}
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
          {/* cardsを1件ずつ描画する。Columnに属するNote(columnChildIdsに含まれるid)は
              トップレベルでは描画せず、ColumnCardView側で描画する。
              CardTypeのimageは未実装のためnullを返し、何も描画しない。 */}
          {cards.map((card) => {
            if (columnChildIds.has(card.id)) return null;

            if (card.type === "note") {
              return (
                <NoteCardView
                  key={card.id}
                  card={card}
                  isSelected={selectedId === card.id}
                  isEditing={editingId === card.id}
                  onSelect={() => setSelectedId(card.id)}
                  onStartEdit={() => setEditingId(card.id)}
                  onCommitText={(text) => {
                    setCards((prev) =>
                      prev.map((c) => (c.id === card.id ? { ...c, text } : c)),
                    );
                    setEditingId(null);
                  }}
                  onPointerDownDrag={(e) => handleCardPointerDown(e, card)}
                  registerRef={(el) => {
                    if (el) cardRefs.current.set(card.id, el);
                    else cardRefs.current.delete(card.id);
                  }}
                  setCards={setCards}
                />
              );
            }

            if (card.type === "swatch") {
              return (
                <div
                  key={card.id}
                  ref={(el) => {
                    if (el) cardRefs.current.set(card.id, el);
                    else cardRefs.current.delete(card.id);
                  }}
                  onPointerDown={(e) => handleCardPointerDown(e, card)}
                  style={{
                    position: "absolute",
                    left: card.x,
                    top: card.y,
                    width: card.width,
                    height: card.height,
                    boxSizing: "border-box",
                    background: card.hex,
                    borderRadius: 4,
                    boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
                    outline:
                      selectedId === card.id ? "2px solid #3b82f6" : "none",
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

            if (card.type === "column") {
              const children = card.cardIds
                .map((id) => cards.find((c) => c.id === id))
                .filter((c): c is NoteCard => !!c && c.type === "note");
              return (
                <ColumnCardView
                  key={card.id}
                  card={card}
                  children={children}
                  isSelected={selectedId === card.id}
                  editingTitle={editingId === card.id}
                  editingNoteId={editingId}
                  selectedId={selectedId}
                  onSelectColumn={() => setSelectedId(card.id)}
                  onStartEditTitle={() => setEditingId(card.id)}
                  onCommitTitle={(title) => {
                    setCards((prev) =>
                      prev.map((c) => (c.id === card.id ? { ...c, title } : c)),
                    );
                    setEditingId(null);
                  }}
                  onDragHeaderPointerDown={(e) =>
                    handleCardPointerDown(e, card)
                  }
                  registerRef={(el) => {
                    if (el) cardRefs.current.set(card.id, el);
                    else cardRefs.current.delete(card.id);
                  }}
                  onAddNote={() => handleAddNoteToColumn(card.id)}
                  onSelectNote={(id) => setSelectedId(id)}
                  onStartEditNote={(id) => setEditingId(id)}
                  onCommitNoteText={(id, text) => {
                    setCards((prev) =>
                      prev.map((c) => (c.id === id ? { ...c, text } : c)),
                    );
                    setEditingId(null);
                  }}
                  setCards={setCards}
                />
              );
            }

            if (card.type === "draw") {
              return (
                <DrawCardView
                  key={card.id}
                  card={card}
                  isSelected={selectedId === card.id}
                  onPointerDownDrag={(e) => handleCardPointerDown(e, card)}
                  registerRef={(el) => {
                    if (el) cardRefs.current.set(card.id, el);
                    else cardRefs.current.delete(card.id);
                  }}
                />
              );
            }

            return null;
          })}

          {/* ペンモード中、描き途中のストロークをライブプレビューするための要素。
              ワールド座標系(worldRefの子)にそのまま置くことで、パン・ズームと一緒に
              動く他のカードと同じ座標系で点列を扱える。cards.mapより後ろに置くことで、
              既存カードの上に重なって見えるようにしている。 */}
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

        {/* ペンモード中だけキャンバス全面に重ねる透明オーバーレイ。
            これより下(worldRef)へのpointerdownを奪うことで、カード選択・ドラッグ・
            背景パンが同時に発生しないようにしている。Sidebar(zIndex:10)より低いzIndexに
            しているので、ペンモード中でもDrawアイコンをクリックして抜けられる。 */}
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
