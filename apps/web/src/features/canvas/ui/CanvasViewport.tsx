// ブラウザ側の動的表示領域を制御するためのラッパー
import styles from "./CanvasViewport.module.css";
import { CanvasStage } from "./CanvasStage";

export function CanvasViewport() {
  return (
    <div
      className={styles.viewport}
      role="region"
      aria-label="アイデアボードのキャンバス"
    >
      CanvasViewport
      <CanvasStage />
    </div>
  );
}
