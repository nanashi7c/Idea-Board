"use client";
import { Layer, Stage, Rect } from "react-konva";
import styles from "./CanvasStage.module.css";
import { useEffect, useRef, useState } from "react";
import Konva from "konva";

const ZOOM_FACTOR = 1.2;
const MIN_SCALE = 0.1;
const MAX_SCALE = 4;

export function CanvasStage() {
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 });

  const containerRef = useRef<HTMLDivElement>(null);

  const handleWheel = (event: Konva.KonvaEventObject<WheelEvent>) => {
    event.evt.preventDefault();
    const stage = event.target.getStage();
    const pointer = stage?.getPointerPosition();

    if (!stage || !pointer) {
      return;
    }

    setViewport((prev) => {
      const requestedScale =
        event.evt.deltaY > 0
          ? prev.scale / ZOOM_FACTOR
          : prev.scale * ZOOM_FACTOR;

      const nextScale = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, requestedScale),
      );

      const pointerPosition = {
        x: (pointer.x - prev.x) / prev.scale,
        y: (pointer.y - prev.y) / prev.scale,
      };

      return {
        x: pointer.x - pointerPosition.x * nextScale,
        y: pointer.y - pointerPosition.y * nextScale,
        scale: nextScale,
      };
    });
  };

  const handlePanStart = (event: Konva.KonvaEventObject<MouseEvent>) => {
    if (event.evt.button !== 1) {
      return;
    }

    event.evt.preventDefault();
    event.target.getStage()?.startDrag();
  };

  // ドラッグされた要素から祖先方向へ一度伝わるのみであるため、Stageの子孫でcancelBubbleをtrueにしなかった場合、onDragEndが無駄に親に伝搬するが、仕様上Stageの子孫コンポーネント階層はあまり深くならないため、オーバーヘッドが発生しても許容する。
  // "Events bubble from shapes through groups and layers, just like the DOM." by https://konvajs.org/docs/index.html
  const handlePanEnd = (event: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = event.target.getStage();
    // そもそもevent.targetがどのStageにも属していない場合、子要素のイベントが親のStageまで伝わってきた場合に、event.targetがStageではなくなるため無視する。
    if (!stage || event.target !== stage) {
      return;
    }

    setViewport((prev) => ({
      ...prev,
      x: stage.x(),
      y: stage.y(),
    }));
  };

  useEffect(() => {
    const container = containerRef.current;

    if (!container) return;
    const updateSize = () => {
      const bounds = container.getBoundingClientRect();

      setSize({
        width: Math.max(1, bounds.width),
        height: Math.max(1, bounds.height),
      });
    };

    updateSize();
  }, []);

  return (
    <div ref={containerRef} className={styles.canvasStage}>
      <Stage
        onWheel={handleWheel}
        onMouseDown={handlePanStart}
        onDragEnd={handlePanEnd}
        width={size.width}
        height={size.height}
        x={viewport.x}
        y={viewport.y}
        scaleX={viewport.scale}
        scaleY={viewport.scale}
      >
        <Layer>
          <Rect x={100} y={80} width={200} height={120} fill="#fff4a8" />
        </Layer>
      </Stage>
    </div>
  );
}
