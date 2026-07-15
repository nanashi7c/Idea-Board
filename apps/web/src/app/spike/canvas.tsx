// Konva（react-konva）はブラウザのCanvas APIに依存するため、
// このコンポーネントはClient Component（ブラウザ側でのみ実行）である必要がある。
"use client";

import { useEffect, useRef, useState } from "react";
import type { DragEvent, ReactNode } from "react";
// react-konva: KonvaというCanvas描画ライブラリをReactのコンポーネントとして使えるようにするラッパー。
// Stage = 描画領域全体（<canvas>要素そのものに相当）
// Layer = Stage内の描画レイヤー（複数重ねられる。今回は1枚だけ使用）
// Group  = 複数の図形をまとめて1つのオブジェクトとして扱う入れ物（カード1枚 = Group 1つ）
// Rect / Text / Line / Image = それぞれ矩形・文字・折れ線・画像を描画する図形コンポーネント
import {
  Stage,
  Layer,
  Rect,
  Text,
  Group,
  Line,
  Image as KonvaImage,
} from "react-konva";
// Konva本体。強制再描画(batchDraw)や、ドラッグ中に直接書き換えるノードの型(Konva.Line)、
// イベントオブジェクトの型(Konva.KonvaEventObject)を使うためにインポートする。
import Konva from "konva";
// packages/shared で定義したTypeScript型をそのままフロントでも使う。
// Card: カード1枚分の型（note/image/swatch/column/drawのunion型）
import type { Card } from "shared";
// カード一覧の初期値・localStorage永続化ロジック。DOM自前実装版(canvas-dom.tsx)と
// 同じボードデータを共有できるよう、レンダラーに依存しない部分は board-storage.ts に切り出している。
// レイアウト計算(layoutColumnChildren)・ワールド座標解決(getCardWorldPosition)・
// カードの再ネスト(moveCardTo/insertCardAtPoint)・循環参照防止(collectDescendantIds)も、
// Konvaに依存しない純粋なデータ操作としてboard-storage.ts側に置き、canvas-dom.tsx側からも
// 将来再利用できるようにしている。
import {
  STORAGE_KEY,
  createNoteCard,
  createColumnCard,
  createDrawCard,
  createImageCard,
  addStrokeToDrawCard,
  getColumnChildIds,
  loadCards,
  layoutColumnChildren,
  getCardWorldPosition,
  collectDescendantIds,
  findDropTargetColumn,
  moveCardTo,
  insertCardAtPoint,
  NOTE_WIDTH,
  NOTE_PADDING,
  NOTE_FONT_SIZE,
  NOTE_LINE_HEIGHT,
  NOTE_MIN_HEIGHT,
  COLUMN_WIDTH,
  COLUMN_TITLE_HEIGHT,
  COLUMN_PADDING,
  ADD_BUTTON_HEIGHT,
  DRAW_STROKE_COLOR,
  DRAW_STROKE_WIDTH,
} from "./board-storage";
import { Sidebar, CARD_TYPE_DRAG_MIME } from "./toolbar";

type DrawCardType = Extract<Card, { type: "draw" }>;
type ImageCardType = Extract<Card, { type: "image" }>;

// 現在編集中のカード(editingId)が、キャンバス上のどのワールド座標に表示されているかを求める。
// Note本文はNote自身、Columnタイトルは対象Column自身が編集対象になる。どちらも
// getCardWorldPosition(board-storage.ts)がColumnのネスト（何段でも）を考慮した
// 実際の描画位置を返してくれるため、ここでは対象の種別(kind)を判定するだけでよい。
// 戻り値のkindによって、下のJSXでtextarea(Note編集)/input(Columnタイトル編集)の
// どちらを出すか、どちらのカードのstateを更新するかを分岐する。
function resolveEditingTarget(editingId: string | null, cards: Card[]) {
  if (!editingId) return null;
  const direct = cards.find((c) => c.id === editingId);
  if (!direct) return null;
  const pos = getCardWorldPosition(editingId, cards);
  if (!pos) return null;
  if (direct.type === "note") {
    return {
      kind: "note" as const,
      id: direct.id,
      x: pos.x,
      y: pos.y,
      width: direct.width,
      text: direct.text,
    };
  }
  if (direct.type === "column") {
    return {
      kind: "column-title" as const,
      id: direct.id,
      x: pos.x,
      y: pos.y,
      width: direct.width,
      text: direct.title,
    };
  }
  return null;
}

// Imageカード1枚分の描画。KonvaのImageコンポーネントはsrcの文字列を直接渡せず、
// 読み込み済みのHTMLImageElement(などのCanvasImageSource)を要求するため、
// data URLからのHTMLImageElement読み込みをこのコンポーネント内で管理する
// (cards.map(...)の中で直接useStateを呼ぶとReactのフックのルールに反するため、
// 専用コンポーネントに切り出す必要がある)。
function ImageCardView({
  card,
  position,
  isSelected,
  isDrawActive,
  onSelect,
  onDragMove,
  onDragEnd,
}: {
  card: ImageCardType;
  position: { x: number; y: number };
  isSelected: boolean;
  isDrawActive: boolean;
  onSelect: () => void;
  onDragMove: (node: Konva.Node) => void;
  onDragEnd: (node: Konva.Node) => void;
}) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    const img = new window.Image();
    img.src = card.src;
    img.onload = () => setImage(img);
    return () => {
      img.onload = null;
    };
  }, [card.src]);

  return (
    <Group
      x={position.x}
      y={position.y}
      draggable={!isDrawActive}
      onClick={() => {
        if (!isDrawActive) onSelect();
      }}
      onDragMove={(e) => onDragMove(e.target)}
      onDragEnd={(e) => onDragEnd(e.target)}
      onMouseEnter={(e) => {
        const container = e.target.getStage()?.container();
        if (container) container.style.cursor = "grab";
      }}
      onMouseLeave={(e) => {
        const container = e.target.getStage()?.container();
        if (container) container.style.cursor = "default";
      }}
    >
      {image && (
        <KonvaImage
          image={image}
          width={card.width}
          height={card.height}
          cornerRadius={4}
          stroke={isSelected ? "#3b82f6" : undefined}
          strokeWidth={isSelected ? 2 : 0}
          shadowBlur={4}
          shadowOpacity={0.2}
        />
      )}
    </Group>
  );
}

// spikeページの本体コンポーネント。カードの状態（配列）と、キャンバスの見た目（拡大率・位置）を
// すべてReactのuseStateで持ち、Konva側はその状態を描画するだけ、という設計にしている。
export function SpikeCanvas() {
  // Stageを内包するラッパーdiv。サイドバーからのHTML5ドラッグ&ドロップは、Konva自身の
  // ポインタ座標系を経由しないネイティブブラウザイベントのため、このrefのgetBoundingClientRect()
  // を使って自前でワールド座標への変換を行う(toWorldPos参照)。
  const wrapperRef = useRef<HTMLDivElement>(null);
  // ペンモードで描画中のストロークをライブプレビューするためのKonva.Lineノード。
  // pointermoveのたびにReactのstateは介さず、このノードのpoints()を直接書き換えて再描画する
  // (カードドラッグの最適化=KONVA_VS_DOM.md「2. ドラッグ」と同じ考え方)。
  const previewLineRef = useRef<Konva.Line>(null);
  // ペンモード中に作成中のDrawカードのid。ペンモードを抜けるまでは、複数回のドラッグ
  // (ストローク)がすべて同じ1枚のDrawカードに追記される。
  const activeDrawCardIdRef = useRef<string | null>(null);

  // Stageの実ピクセルサイズ（ウィンドウいっぱいに表示するため、画面サイズと同期させる）。
  // このコンポーネントはpage.tsxでssr: falseとして動的importされているため、関数本体は
  // ブラウザ上でしか実行されずwindowは常に参照できる。初期値を{width:0, height:0}にすると、
  // Stageが一瞬0x0で描画された際にKonva内部のbufferCanvas(cornerRadiusとshadowを同時に
  // 持つImageノードの描画で使われる。node_modules/konva/lib/shapes/Image.jsの
  // _useBufferCanvas、Stage.jsのbufferCanvas参照)も0x0で作られてしまい、Imageカードの
  // 追加時に「Failed to execute 'drawImage' ... width or height of 0」という実行時エラーに
  // なる不具合があったため、初回から実際のwindowサイズを使う。
  const [size, setSize] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  // キャンバス全体の拡大率（ズーム）。1が等倍。
  const [scale, setScale] = useState(1);
  // キャンバス全体の表示位置（パン）。Stage自体をドラッグして動かした時の位置を保持する。
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  // カード一覧そのもの。ここが「ボードの中身」の実体で、Undo・保存・整列など、
  // 今後追加する機能はすべてこの配列をどう更新するかという話になる。
  const [cards, setCards] = useState<Card[]>(loadCards);
  // 現在選択中のカードのID（枠線をハイライトするために使う）。何も選んでいなければnull。
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 現在編集中のカードのID。Noteならテキスト、Columnならタイトルの編集を表す。
  // Konvaは文字入力欄を持たないため、editingIdがセットされている間だけHTMLの
  // <textarea>/<input>をKonvaの上に重ねて表示する（後述）。
  const [editingId, setEditingId] = useState<string | null>(null);
  // Drawアイコンをオンにしている間(ペンモード)かどうか。trueの間はStageのパン・
  // カードの選択/ドラッグ/編集開始をすべて無効化し、Stage上のどこを押してもストローク
  // 描画が始まるようにする。
  const [isDrawActive, setIsDrawActive] = useState(false);
  // カードをColumnへドラッグ中、現在ポインタの下にある「入れ子先候補」のColumnのid。
  // ドロップ前にどのColumnに入るかをハイライト表示するためだけの見た目用stateで、
  // cards配列そのもの（実際の親子関係）には影響しない。
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  // ウィンドウサイズが変わった時（リサイズ）にStageのサイズも追従させるための副作用。
  useEffect(() => {
    const updateSize = () =>
      setSize({ width: window.innerWidth, height: window.innerHeight });
    updateSize(); // 初期state設定後にリサイズが起きていた場合に備えて念のため再同期
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  // cards配列が変わるたびにlocalStorageへ保存する副作用。
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
      // テキスト編集中（<textarea>/<input>にフォーカスがある状態）にBackspaceを押すと
      // 文字を消したいだけなのにカードごと消えてしまうため、編集中は何もしない。
      if (editingId !== null) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        setCards((prev) => {
          // Columnを削除する時は、中の子カードも一緒に削除する
          // (Columnのエントリだけ消すと、子カードがトップレベルの孤児として復活して見えてしまうため)。
          // collectDescendantIdsはColumnの子・孫...と何段ネストしていても再帰的に集めてくれる
          // (selectedIdがColumnでなければ空集合を返すので、Note等の削除では従来どおり1件だけ消える)。
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
    // selectedId/editingId/isDrawActiveはhandleKeyDownの中で参照している値なので、
    // 依存配列に含める必要がある（含めないと、登録時点の古い値を参照し続けてしまう
    // ＝いわゆる「クロージャの罠」）。
  }, [selectedId, editingId, isDrawActive]);

  // Columnに属する(＝トップレベルでは描画しない)カードのid一覧。
  const columnChildIds = getColumnChildIds(cards);
  // 現在編集中の対象(Note本文 or Columnタイトル)のワールド座標・種別。
  const editingTarget = resolveEditingTarget(editingId, cards);

  // スクリーン座標(clientX/Y)を、パン・ズームを差し引いたワールド座標に変換する。
  // サイドバーからのドロップ位置計算に使う。
  const toWorldPos = (clientX: number, clientY: number) => {
    const rect = wrapperRef.current!.getBoundingClientRect();
    return {
      x: (clientX - rect.left - stagePos.x) / scale,
      y: (clientY - rect.top - stagePos.y) / scale,
    };
  };

  // ドラッグ中のKonvaノードの現在位置を、cards配列と同じ「ワールド座標」に変換する。
  // node.getAbsolutePosition()はStage自身のscale/x/yまで含めた画面ピクセル座標を返すため、
  // Stageのscale/stagePosを逆算して差し引く。Columnの子として何段ネストしていても
  // (Group内のGroup内のGroup…でも)、Konvaが親子の変換を積算した絶対位置を返してくれるので、
  // ここでは一律にStage分だけ逆変換すればよい。
  const nodeToWorldPos = (node: Konva.Node) => {
    const abs = node.getAbsolutePosition();
    return {
      x: (abs.x - stagePos.x) / scale,
      y: (abs.y - stagePos.y) / scale,
    };
  };

  // カードのドラッグ中(dragmove毎)に呼ぶ。ポインタの下に入れ子先候補のColumnがあれば
  // そのidをdropTargetIdへ入れ、ハイライト表示する。cardIdは、そのColumn自身または
  // 子孫Columnへドロップしてしまう(自己ネスト・循環ネスト)のを防ぐための除外対象。
  const handleCardDragMove = (cardId: string, node: Konva.Node) => {
    const target = findDropTargetColumn(nodeToWorldPos(node), cardId, cards);
    setDropTargetId(target?.id ?? null);
  };

  // カードのドラッグを離した(dragend)時に呼ぶ。ポインタの下に入れ子先候補のColumnが
  // あればそのColumnの子として再ネストし、無ければ現在位置をそのままトップレベルの
  // x, yとして確定する（moveCardTo参照）。
  const handleCardDragEnd = (cardId: string, node: Konva.Node) => {
    const worldPos = nodeToWorldPos(node);
    setCards((prev) => {
      const target = findDropTargetColumn(worldPos, cardId, prev);
      return moveCardTo(
        prev,
        cardId,
        target ? { columnId: target.id } : { worldPos },
      );
    });
    setDropTargetId(null);
  };

  // サイドバーのImageアイコンで選択したファイル、またはドラッグ&ドロップされた画像ファイルを
  // 読み込み、指定したワールド座標を中心にImageカードとして追加する共通処理。
  // data URL化するのはlocalStorageへの保存(JSON.stringify)にそのまま乗せるため
  // (Blob URLはページをリロードすると失効し、参照が壊れてしまう)。
  const addImageCardAt = (file: File, center: { x: number; y: number }) => {
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result;
      if (typeof src !== "string") return;
      const img = new Image();
      img.onload = () => {
        // createImageCardはIMAGE_MAX_WIDTH/HEIGHTに収まるよう縮小した幅・高さを返すため、
        // 先に(0, 0)で作ってからその幅・高さを使ってcenterが中心に来るx, yを計算し直す。
        const placeholder = createImageCard(
          0,
          0,
          src,
          img.naturalWidth,
          img.naturalHeight,
        );
        const newCard = {
          ...placeholder,
          x: center.x - placeholder.width / 2,
          y: center.y - placeholder.height / 2,
        };
        // centerが既存Columnの領域内なら、トップレベルではなくそのColumnの子として追加する。
        setCards((prev) => insertCardAtPoint(prev, newCard, center));
        setSelectedId(newCard.id);
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  // サイドバーのImageアイコンで選択したファイルを、画面中央にImageカードとして追加する。
  const handlePickImageFile = (file: File) => {
    addImageCardAt(
      file,
      toWorldPos(window.innerWidth / 2, window.innerHeight / 2),
    );
  };

  // サイドバーのNote/Columnアイコン、またはOSのファイルをキャンバス上にドラッグ&ドロップ
  // した時の受け皿。dataTransfer.typesにCARD_TYPE_DRAG_MIME(サイドバー発)か
  // "Files"(OSのファイルドラッグ)のどちらかが載っている時だけドロップを許可する。
  const handleContainerDragOver = (e: DragEvent<HTMLDivElement>) => {
    const isCardDrag = e.dataTransfer.types.includes(CARD_TYPE_DRAG_MIME);
    const isFileDrag = e.dataTransfer.types.includes("Files");
    if (!isCardDrag && !isFileDrag) return;
    e.preventDefault(); // これを呼ばないとdropイベントが発火しない(HTML5 D&Dの仕様)
    e.dataTransfer.dropEffect = "copy";
  };

  const handleContainerDrop = (e: DragEvent<HTMLDivElement>) => {
    // OSのファイルマネージャ等から画像ファイルが直接ドロップされた場合。
    // 複数枚まとめてドロップされても完全に重ならないよう、1枚ごとに少しずつ
    // ドロップ位置をずらして配置する。
    if (e.dataTransfer.files.length > 0) {
      e.preventDefault();
      const pos = toWorldPos(e.clientX, e.clientY);
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
    // ドロップ位置が既存Columnの領域内なら、トップレベルではなくそのColumnの子として追加する。
    setCards((prev) => insertCardAtPoint(prev, newCard, pos));
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
  // そのidを対象Columnのcardsに登録する。子Noteのx, yはColumn側のlayoutColumnChildrenが
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

  const updatePreviewLine = (points: { x: number; y: number }[]) => {
    previewLineRef.current?.points(points.flatMap((p) => [p.x, p.y]));
    previewLineRef.current?.getLayer()?.batchDraw();
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

  // ペンモード中のストローク描画。Stage自体のonPointerDownに付けているため、
  // カードの上でも背景でも(Konvaのイベントは子から親へバブリングするため)発火する。
  // カード側のdraggable/onClickはisDrawActiveがtrueの間すべて無効化しているため
  // (各カードのdraggable={!isDrawActive}、onClick内のif (!isDrawActive)ガードを参照)、
  // 選択やドラッグと競合しない。
  const handleStagePointerDown = (e: Konva.KonvaEventObject<PointerEvent>) => {
    if (!isDrawActive) return;
    const stage = e.target.getStage();
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;
    const start = {
      x: (pointer.x - stagePos.x) / scale,
      y: (pointer.y - stagePos.y) / scale,
    };
    const points = [start];
    updatePreviewLine(points);

    const onMove = (ev: PointerEvent) => {
      const rect = wrapperRef.current!.getBoundingClientRect();
      points.push({
        x: (ev.clientX - rect.left - stagePos.x) / scale,
        y: (ev.clientY - rect.top - stagePos.y) / scale,
      });
      updatePreviewLine(points);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      commitStroke(points);
      updatePreviewLine([]);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // カード1件分の描画。トップレベル（position省略、card自身のx, yを使う）と、
  // Column内の子カード（positionにlayoutColumnChildrenが計算した相対位置を渡す）の
  // 両方から呼べる共通関数にすることで、Note/Image/Swatch/Draw/Columnどの種類のカードも
  // 「トップレベルかColumnの中か」「Columnの中なら何段ネストしているか」を問わず同じ
  // 見た目・同じドラッグ挙動で描画できる。Columnの中でrenderCardを再帰呼び出しすることで、
  // Column in Columnの無制限ネストに対応している。
  const renderCard = (
    card: Card,
    position?: { x: number; y: number },
  ): ReactNode => {
    const pos = position ?? { x: card.x, y: card.y };

    if (card.type === "note") {
      return (
        <Group
          key={card.id}
          x={pos.x}
          y={pos.y}
          draggable={!isDrawActive}
          onClick={() => {
            if (!isDrawActive) setSelectedId(card.id);
          }}
          onDblClick={() => {
            if (!isDrawActive) setEditingId(card.id);
          }}
          onDragMove={(e) => handleCardDragMove(card.id, e.target)}
          onDragEnd={(e) => handleCardDragEnd(card.id, e.target)}
          // カードにマウスが乗ったらカーソルを変える（canvas-dom版のcursor相当）。
          // Konvaは<canvas>1枚に描画しているためCSSのcursorプロパティを図形ごとに
          // 指定できず、Stageのコンテナ要素のstyle.cursorを直接書き換える必要がある。
          onMouseEnter={(e) => {
            const container = e.target.getStage()?.container();
            if (container) {
              container.style.cursor = editingId === card.id ? "text" : "grab";
            }
          }}
          onMouseLeave={(e) => {
            const container = e.target.getStage()?.container();
            if (container) container.style.cursor = "default";
          }}
        >
          <Rect
            width={NOTE_WIDTH}
            height={card.height}
            fill={card.color}
            stroke={selectedId === card.id ? "#3b82f6" : undefined}
            strokeWidth={selectedId === card.id ? 2 : 0}
            cornerRadius={4}
            shadowBlur={4}
            shadowOpacity={0.2}
          />
          <Text
            text={card.text}
            width={NOTE_WIDTH}
            height={card.height}
            padding={NOTE_PADDING}
            fontSize={NOTE_FONT_SIZE}
            // Konvaのline-heightはfontSizeに対する倍率で指定するため、
            // DOM版と見た目を揃えるためNOTE_LINE_HEIGHT(px)をfontSizeで割って渡す。
            lineHeight={NOTE_LINE_HEIGHT / NOTE_FONT_SIZE}
            wrap="word"
            // 横長カード内でテキストを縦センタリングする(Konva.Textのverticalalign機能)。
            verticalAlign="middle"
            visible={editingId !== card.id}
          />
        </Group>
      );
    }

    if (card.type === "swatch") {
      return (
        <Group
          key={card.id}
          x={pos.x}
          y={pos.y}
          draggable={!isDrawActive}
          onClick={() => {
            if (!isDrawActive) setSelectedId(card.id);
          }}
          onDragMove={(e) => handleCardDragMove(card.id, e.target)}
          onDragEnd={(e) => handleCardDragEnd(card.id, e.target)}
          onMouseEnter={(e) => {
            const container = e.target.getStage()?.container();
            if (container) container.style.cursor = "grab";
          }}
          onMouseLeave={(e) => {
            const container = e.target.getStage()?.container();
            if (container) container.style.cursor = "default";
          }}
        >
          <Rect
            width={card.width}
            height={card.height}
            fill={card.hex}
            stroke={selectedId === card.id ? "#3b82f6" : undefined}
            strokeWidth={selectedId === card.id ? 2 : 0}
            cornerRadius={4}
            shadowBlur={4}
            shadowOpacity={0.2}
          />
          <Text
            text={card.hex}
            width={card.width}
            height={card.height}
            align="center"
            verticalAlign="middle"
            fontSize={13}
            fill="#ffffff"
          />
        </Group>
      );
    }

    if (card.type === "image") {
      return (
        <ImageCardView
          key={card.id}
          card={card}
          position={pos}
          isSelected={selectedId === card.id}
          isDrawActive={isDrawActive}
          onSelect={() => setSelectedId(card.id)}
          onDragMove={(node) => handleCardDragMove(card.id, node)}
          onDragEnd={(node) => handleCardDragEnd(card.id, node)}
        />
      );
    }

    if (card.type === "draw") {
      return (
        <Group
          key={card.id}
          x={pos.x}
          y={pos.y}
          draggable={!isDrawActive}
          onClick={() => {
            if (!isDrawActive) setSelectedId(card.id);
          }}
          onDragMove={(e) => handleCardDragMove(card.id, e.target)}
          onDragEnd={(e) => handleCardDragEnd(card.id, e.target)}
          onMouseEnter={(e) => {
            const container = e.target.getStage()?.container();
            if (container) container.style.cursor = "grab";
          }}
          onMouseLeave={(e) => {
            const container = e.target.getStage()?.container();
            if (container) container.style.cursor = "default";
          }}
        >
          {/* 選択時のハイライト・クリック判定用の透明Rect。strokeのみのRectは
              線の上でしかクリック判定が成立しないKonvaの仕様があるため、
              fillを透明色にして矩形全体をヒット領域にしている。 */}
          <Rect
            width={card.width}
            height={card.height}
            fill="transparent"
            stroke={selectedId === card.id ? "#3b82f6" : undefined}
            strokeWidth={selectedId === card.id ? 2 : 0}
          />
          {card.strokes.map((stroke, i) => (
            <Line
              key={i}
              points={stroke.flatMap((p) => [p.x, p.y])}
              stroke={DRAW_STROKE_COLOR}
              strokeWidth={DRAW_STROKE_WIDTH}
              lineCap="round"
              lineJoin="round"
              listening={false}
            />
          ))}
        </Group>
      );
    }

    if (card.type === "column") {
      const { items, addButtonY, totalHeight } = layoutColumnChildren(
        card,
        cards,
      );
      const isDropTarget = dropTargetId === card.id;
      return (
        <Group key={card.id} x={pos.x} y={pos.y}>
          <Rect
            width={COLUMN_WIDTH}
            height={totalHeight}
            fill="#e5e7eb"
            cornerRadius={6}
            // ドラッグ中のカードの入れ子先候補になっている間は、選択中の枠色とは別の色
            // (緑)でハイライトし、「ここに入る」ことが分かるようにする。
            stroke={
              isDropTarget
                ? "#22c55e"
                : selectedId === card.id
                  ? "#3b82f6"
                  : undefined
            }
            strokeWidth={isDropTarget || selectedId === card.id ? 2 : 0}
            shadowBlur={4}
            shadowOpacity={0.2}
          />
          {/* タイトルバー。ドラッグハンドルを兼ねる。KonvaのGroup自体をdraggableに
              すると本文中のカードや「+ Note」ボタンのクリックまでドラッグ扱いに
              なりかねないため、このRectだけをdraggableにし、動いた分を親Groupへ
              転写してから自身は(0,0)に戻す、という「ドラッグハンドル」パターンを使う。 */}
          <Rect
            draggable={!isDrawActive}
            width={COLUMN_WIDTH}
            height={COLUMN_TITLE_HEIGHT}
            fill="transparent"
            onClick={() => {
              if (!isDrawActive) setSelectedId(card.id);
            }}
            onDblClick={() => {
              if (!isDrawActive) setEditingId(card.id);
            }}
            onDragMove={(e) => {
              const handle = e.target;
              const group = handle.getParent();
              if (group) {
                group.position({
                  x: group.x() + handle.x(),
                  y: group.y() + handle.y(),
                });
              }
              handle.position({ x: 0, y: 0 });
              // ハンドルをリセットした直後は、ハンドルの絶対位置が親Groupの絶対位置と
              // 一致するため、そのままhandleCardDragMoveに渡してよい。
              handleCardDragMove(card.id, handle);
            }}
            onDragEnd={(e) => {
              const group = e.target.getParent();
              if (group) handleCardDragEnd(card.id, group);
            }}
            onMouseEnter={(e) => {
              const container = e.target.getStage()?.container();
              if (container) {
                container.style.cursor =
                  editingId === card.id ? "text" : "grab";
              }
            }}
            onMouseLeave={(e) => {
              const container = e.target.getStage()?.container();
              if (container) container.style.cursor = "default";
            }}
          />
          <Text
            text={card.title}
            width={COLUMN_WIDTH}
            height={COLUMN_TITLE_HEIGHT}
            padding={COLUMN_PADDING}
            fontSize={14}
            fontStyle="bold"
            verticalAlign="middle"
            listening={false}
            visible={editingId !== card.id}
          />
          {/* 子カードの描画。子がColumnの場合はrenderCardが再帰的に自分自身を呼ぶため、
              Column in Columnが何段ネストしていてもそのまま描画できる。 */}
          {items.map(({ child, x, y }) => renderCard(child, { x, y }))}
          <Rect
            x={COLUMN_PADDING}
            y={addButtonY}
            width={COLUMN_WIDTH - COLUMN_PADDING * 2}
            height={ADD_BUTTON_HEIGHT}
            stroke="#94a3b8"
            dash={[4, 4]}
            cornerRadius={4}
            onClick={() => {
              if (!isDrawActive) handleAddNoteToColumn(card.id);
            }}
            onMouseEnter={(e) => {
              const container = e.target.getStage()?.container();
              if (container) container.style.cursor = "pointer";
            }}
            onMouseLeave={(e) => {
              const container = e.target.getStage()?.container();
              if (container) container.style.cursor = "default";
            }}
          />
          <Text
            text="+ Note"
            x={COLUMN_PADDING}
            y={addButtonY}
            width={COLUMN_WIDTH - COLUMN_PADDING * 2}
            height={ADD_BUTTON_HEIGHT}
            align="center"
            verticalAlign="middle"
            fontSize={13}
            fill="#475569"
            listening={false}
          />
        </Group>
      );
    }

    return null;
  };

  return (
    // <> </> はReact Fragment。サイドバー・KonvaのStage（Canvas）と、
    // その上に重ねるHTMLの<textarea>/<input>を、余分なdivを挟まずに並べて返すために使っている。
    <>
      <Sidebar
        isDrawActive={isDrawActive}
        onToggleDraw={handleToggleDraw}
        onPickImageFile={handlePickImageFile}
      />
      {/* wrapperRef: Stageを内包する画面いっぱいのdiv。サイドバーからのドラッグ&ドロップは
          Konvaのコンポーネントではなく、この素のdivのonDragOver/onDropで受ける
          (react-konvaのStageはKonvaの設定に対応するprops以外を素通ししないため)。 */}
      <div
        ref={wrapperRef}
        onDragOver={handleContainerDragOver}
        onDrop={handleContainerDrop}
        style={{
          position: "fixed",
          inset: 0,
          cursor: isDrawActive ? "crosshair" : undefined,
        }}
      >
        <Stage
          // Stageの実ピクセルサイズ。ウィンドウサイズに追従（上のuseEffect参照）。
          width={size.width}
          height={size.height}
          // editingId === null かつ ペンモードでない間だけStage自体をドラッグでパンできるようにする。
          draggable={editingId === null && !isDrawActive}
          // 拡大率。X/Y同じ値にして縦横比を保ったままズームする。
          scaleX={scale}
          scaleY={scale}
          x={stagePos.x}
          y={stagePos.y}
          // マウスホイールでのズーム処理。マウスカーソルの位置を基準にズームする
          // （カーソル直下の座標がズーム前後で画面上の同じ位置に留まるように、拡大率と
          // 同時にstagePosも再計算する）。
          onWheel={(e) => {
            // ブラウザ標準のページスクロールが同時に起きないようにする。
            e.evt.preventDefault();
            const stage = e.target.getStage();
            // ポインタ位置（Stageコンテナ基準・拡大率やパンの影響を受けない画面座標）を取得する。
            const pointer = stage?.getPointerPosition();
            if (!pointer) return;
            const oldScale = scale;
            // ポインタ位置を、現在の拡大率・パン位置を差し引いた「ワールド座標」に変換する。
            const mousePointTo = {
              x: (pointer.x - stagePos.x) / oldScale,
              y: (pointer.y - stagePos.y) / oldScale,
            };
            // 1回のホイール操作あたりの拡大/縮小率。
            const scaleBy = 1.05;
            // deltaYが正（下スクロール）なら縮小、負（上スクロール）なら拡大。
            const newScale =
              e.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy;
            setScale(newScale);
            // ワールド座標上の同じ点が、新しい拡大率でも同じ画面座標（pointer）に来るように
            // stagePosを再計算する。
            setStagePos({
              x: pointer.x - mousePointTo.x * newScale,
              y: pointer.y - mousePointTo.y * newScale,
            });
          }}
          // ペンモード中のストローク開始（詳細はhandleStagePointerDown参照）。
          onPointerDown={handleStagePointerDown}
          // Stage（背景部分）をドラッグし終えた時に、パン後の位置をstateへ反映する。
          //
          // 【ここが実際にハマったバグの箇所】
          // Konvaのドラッグイベントは、子要素（カードのGroup）から親（Stage）へ「バブリング」
          // （伝播）する。カードをドラッグして離した瞬間、Stage側のonDragEndも一緒に発火して
          // しまうため、実際にドラッグされたのがStage自身の時だけ処理するようガードしている。
          onDragEnd={(e) => {
            if (e.target === e.target.getStage()) {
              setStagePos({ x: e.target.x(), y: e.target.y() });
            }
          }}
          // 背景（カード以外の部分）をクリックしたら選択解除する。ペンモード中は無視する。
          onClick={(e) => {
            if (isDrawActive) return;
            if (e.target === e.target.getStage()) setSelectedId(null);
          }}
        >
          <Layer>
            {/* cardsを1件ずつ描画する。Columnに属するカードはトップレベルでは描画せず、
                Column自身の描画の中(renderCardの再帰呼び出し)で描画する。 */}
            {cards.map((card) =>
              columnChildIds.has(card.id) ? null : renderCard(card),
            )}

            {/* ペンモード中、描き途中のストロークをライブプレビューするための要素。
                cards.mapより後ろに置くことで、既存カードの上に重なって見えるようにしている。 */}
            <Line
              ref={previewLineRef}
              points={[]}
              stroke={DRAW_STROKE_COLOR}
              strokeWidth={DRAW_STROKE_WIDTH}
              lineCap="round"
              lineJoin="round"
              listening={false}
            />
          </Layer>
        </Stage>
      </div>

      {editingTarget && editingTarget.kind === "note" && (
        // Konva（Canvas）には文字入力用のUIが無いため、編集中だけ本物のHTML <textarea> を
        // カードの真上に重ねて表示し、あたかもカード自体を編集しているように見せている。
        // 表示行数(折り返し含む)に応じてカードの高さを変えるため、textarea自体もscrollHeightを
        // 使って毎入力ごとに高さを合わせ(auto-grow textareaの定番手順)、確定時(onBlur)に
        // その高さをcard.heightとして保存する(DOM版と同じ考え方)。
        <textarea
          autoFocus
          defaultValue={editingTarget.text}
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
            position: "absolute",
            top: editingTarget.y * scale + stagePos.y,
            left: editingTarget.x * scale + stagePos.x,
            width: editingTarget.width * scale,
            minHeight: NOTE_MIN_HEIGHT * scale,
            fontSize: NOTE_FONT_SIZE * scale,
            padding: NOTE_PADDING * scale,
            border: "2px solid #3b82f6",
            borderRadius: 4,
            resize: "none",
            overflow: "hidden",
            boxSizing: "border-box",
          }}
          onBlur={(e) => {
            const text = e.target.value;
            // scrollHeightは画面のズーム倍率がかかったCSS px。カード自体の座標系
            // (ズームの影響を受けない「素の」座標)に戻すため、scaleで割る。
            const measuredHeight = e.target.scrollHeight / scale;
            setCards((prev) =>
              prev.map((c) =>
                c.id === editingTarget.id
                  ? {
                      ...c,
                      text,
                      height: Math.max(NOTE_MIN_HEIGHT, measuredHeight),
                    }
                  : c,
              ),
            );
            setEditingId(null);
          }}
        />
      )}

      {editingTarget && editingTarget.kind === "column-title" && (
        <input
          autoFocus
          defaultValue={editingTarget.text}
          style={{
            position: "absolute",
            top: editingTarget.y * scale + stagePos.y,
            left: editingTarget.x * scale + stagePos.x,
            width: editingTarget.width * scale,
            height: COLUMN_TITLE_HEIGHT * scale,
            fontSize: 14 * scale,
            fontWeight: "bold",
            padding: `0 ${COLUMN_PADDING * scale}px`,
            border: "2px solid #3b82f6",
            borderRadius: 4,
            boxSizing: "border-box",
          }}
          onBlur={(e) => {
            const title = e.target.value;
            setCards((prev) =>
              prev.map((c) =>
                c.id === editingTarget.id ? { ...c, title } : c,
              ),
            );
            setEditingId(null);
          }}
        />
      )}
    </>
  );
}
