// Konva（react-konva）はブラウザのCanvas APIに依存するため、Client Componentである必要がある。
"use client";

import { useEffect, useRef, useState } from "react";
import type { DragEvent, ReactNode } from "react";
import {
  Stage,
  Layer,
  Rect,
  Text,
  Group,
  Line,
  Image as KonvaImage,
} from "react-konva";
// react-konvaに加えてKonva本体をimportしているのは、強制再描画(batchDraw)やKonva.Line/Konva.KonvaEventObjectの型を直接使うため。
import Konva from "konva";
import type { Card } from "shared";
// レイアウト計算・ワールド座標解決・カードの再ネスト・循環参照防止など、Konvaに依存しないデータ操作はcanvas-dom.tsxとも共有できるようboard-storage.tsに切り出している。
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

// KonvaのImageコンポーネントはsrcの文字列を直接渡せず読み込み済みのHTMLImageElementを要求するため、data URLからの読み込みを管理する専用コンポーネントに切り出している(cards.map(...)の中で直接useStateを呼ぶとReactのフックのルールに反するため)。
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

export function SpikeCanvas() {
  // サイドバーからのHTML5ドラッグ&ドロップはKonvaのポインタ座標系を経由しないネイティブブラウザイベントのため、このrefのgetBoundingClientRect()で自前にワールド座標へ変換する。
  const wrapperRef = useRef<HTMLDivElement>(null);
  // ペンモード中のライブプレビュー用ノード。pointermoveのたびにReactのstateは介さずpoints()を直接書き換えて再描画する(カードドラッグの最適化と同じ考え方)。
  const previewLineRef = useRef<Konva.Line>(null);
  // ペンモード中に作成中のDrawカードのid。ペンモードを抜けるまでは複数回のストロークがすべて同じ1枚のDrawカードに追記される。
  const activeDrawCardIdRef = useRef<string | null>(null);

  // 初期値を{width:0, height:0}にすると、Stageが一瞬0x0で描画された際にKonva内部のbufferCanvas(cornerRadiusとshadowを同時に持つImageノードの描画で使われる)も0x0で作られ、Imageカード追加時に「Failed to execute 'drawImage' ... width or height of 0」という実行時エラーになる不具合があったため、初回から実際のwindowサイズを使う。
  const [size, setSize] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  const [scale, setScale] = useState(1);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [cards, setCards] = useState<Card[]>(loadCards);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isDrawActive, setIsDrawActive] = useState(false);
  // カードをColumnへドラッグ中の入れ子先候補id。ハイライト表示専用のstateで、cards配列の実際の親子関係には影響しない。
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  useEffect(() => {
    const updateSize = () =>
      setSize({ width: window.innerWidth, height: window.innerHeight });
    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

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
    // selectedId/editingId/isDrawActiveはhandleKeyDown内で参照する値なので依存配列に含める必要がある(含めないと登録時点の古い値を参照し続けるクロージャの罠になる)。
  }, [selectedId, editingId, isDrawActive]);

  const columnChildIds = getColumnChildIds(cards);
  const editingTarget = resolveEditingTarget(editingId, cards);

  const toWorldPos = (clientX: number, clientY: number) => {
    const rect = wrapperRef.current!.getBoundingClientRect();
    return {
      x: (clientX - rect.left - stagePos.x) / scale,
      y: (clientY - rect.top - stagePos.y) / scale,
    };
  };

  // node.getAbsolutePosition()はStage自身のscale/x/yまで含めた画面ピクセル座標を返すため、Columnの子として何段ネストしていてもStage分だけ逆変換すればワールド座標になる。
  const nodeToWorldPos = (node: Konva.Node) => {
    const abs = node.getAbsolutePosition();
    return {
      x: (abs.x - stagePos.x) / scale,
      y: (abs.y - stagePos.y) / scale,
    };
  };

  const handleCardDragMove = (cardId: string, node: Konva.Node) => {
    const target = findDropTargetColumn(nodeToWorldPos(node), cardId, cards);
    setDropTargetId(target?.id ?? null);
  };

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

  // 読み込み自体はすぐ失効してよいBlob URLで行う(Imageへdrawした直後にrevokeするだけ)。localStorageに保存するdata URL化はcreateImageCard内で縮小後サイズに対して行う(元画像そのままdata URL化するとQuotaExceededErrorに繋がりやすいため)。
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

  const handleContainerDragOver = (e: DragEvent<HTMLDivElement>) => {
    const isCardDrag = e.dataTransfer.types.includes(CARD_TYPE_DRAG_MIME);
    const isFileDrag = e.dataTransfer.types.includes("Files");
    if (!isCardDrag && !isFileDrag) return;
    e.preventDefault(); // これを呼ばないとdropイベントが発火しない(HTML5 D&Dの仕様)
    e.dataTransfer.dropEffect = "copy";
  };

  const handleContainerDrop = (e: DragEvent<HTMLDivElement>) => {
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

  const updatePreviewLine = (points: { x: number; y: number }[]) => {
    previewLineRef.current?.points(points.flatMap((p) => [p.x, p.y]));
    previewLineRef.current?.getLayer()?.batchDraw();
  };

  const commitStroke = (worldPoints: { x: number; y: number }[]) => {
    // firstPointのundefinedチェックは、下のlengthガードにより実行時には必ず通過するが、
    // TypeScriptの配列アクセスは長さチェックと連動して絞り込まれないため明示している。
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

  // Stage自体のonPointerDownに付けているため、Konvaのイベントバブリングによりカードの上でも背景でも発火する。各カードのdraggable/onClickはisDrawActive中すべて無効化しているため、選択やドラッグと競合しない。
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

  // トップレベル(position省略)とColumn内の子カード(positionに相対位置を渡す)の両方から呼べる共通関数にすることで、Columnの中でrenderCardを再帰呼び出しし、Column in Columnの無制限ネストに対応している。
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
          // Konvaは<canvas>1枚に描画しているためCSSのcursorを図形ごとに指定できず、Stageのコンテナ要素のstyle.cursorを直接書き換える必要がある。
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
            // Konvaのline-heightはfontSizeに対する倍率で指定するため、DOM版と見た目を揃えるためNOTE_LINE_HEIGHT(px)をfontSizeで割って渡す。
            lineHeight={NOTE_LINE_HEIGHT / NOTE_FONT_SIZE}
            wrap="word"
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
          {/* strokeのみのRectは線の上でしかクリック判定が成立しないKonvaの仕様があるため、fillを透明色にして矩形全体をヒット領域にしている。 */}
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
          {/* タイトルバーはドラッグハンドルを兼ねる。Group自体をdraggableにすると本文中のカードや「+ Note」ボタンのクリックまでドラッグ扱いになりかねないため、このRectだけをdraggableにし、動いた分を親Groupへ転写してから自身は(0,0)に戻す、という「ドラッグハンドル」パターンを使う。 */}
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
              // ハンドルをリセットした直後は、ハンドルの絶対位置が親Groupの絶対位置と一致するため、そのままhandleCardDragMoveに渡してよい。
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
    <>
      <Sidebar
        isDrawActive={isDrawActive}
        onToggleDraw={handleToggleDraw}
        onPickImageFile={handlePickImageFile}
      />
      {/* サイドバーからのドラッグ&ドロップはこの素のdivのonDragOver/onDropで受ける(react-konvaのStageはKonvaの設定に対応するprops以外を素通ししないため)。 */}
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
          width={size.width}
          height={size.height}
          draggable={editingId === null && !isDrawActive}
          scaleX={scale}
          scaleY={scale}
          x={stagePos.x}
          y={stagePos.y}
          // マウスカーソルの位置を基準にズームする(カーソル直下の座標がズーム前後で画面上の同じ位置に留まるように、拡大率と同時にstagePosも再計算する)。
          onWheel={(e) => {
            e.evt.preventDefault(); // ブラウザ標準のページスクロールを止める
            const stage = e.target.getStage();
            const pointer = stage?.getPointerPosition();
            if (!pointer) return;
            const oldScale = scale;
            const mousePointTo = {
              x: (pointer.x - stagePos.x) / oldScale,
              y: (pointer.y - stagePos.y) / oldScale,
            };
            const scaleBy = 1.05;
            const newScale =
              e.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy;
            setScale(newScale);
            setStagePos({
              x: pointer.x - mousePointTo.x * newScale,
              y: pointer.y - mousePointTo.y * newScale,
            });
          }}
          onPointerDown={handleStagePointerDown}
          // 【ハマったバグの対策】Konvaのドラッグイベントは子要素(カードのGroup)から親(Stage)へバブリングする。カードをドラッグして離した瞬間、Stage側のonDragEndも一緒に発火してしまうため、実際にドラッグされたのがStage自身の時だけ処理するようガードしている。
          onDragEnd={(e) => {
            if (e.target === e.target.getStage()) {
              setStagePos({ x: e.target.x(), y: e.target.y() });
            }
          }}
          onClick={(e) => {
            if (isDrawActive) return;
            if (e.target === e.target.getStage()) setSelectedId(null);
          }}
        >
          <Layer>
            {cards.map((card) =>
              columnChildIds.has(card.id) ? null : renderCard(card),
            )}

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
        // Konva(Canvas)には文字入力用のUIが無いため、編集中だけ本物のHTML <textarea> をカードの真上に重ねて表示する。scrollHeightを使って毎入力ごとに高さを合わせ、確定時(onBlur)にその高さをcard.heightとして保存する。
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
            // scrollHeightは画面のズーム倍率がかかったCSS pxのため、カード自体の座標系(ズームの影響を受けない値)に戻すためscaleで割る。
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
