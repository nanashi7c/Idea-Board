// HTML5ドラッグ&ドロップ(draggable属性・dataTransfer)とonClickだけで完結するため、
// canvas.tsx(Konva)・canvas-dom.tsx(DOM自前実装)のどちらからも同じ見た目・同じ挙動で使える。
"use client";

import { useRef } from "react";
import type { ChangeEvent, DragEvent, ReactNode } from "react";

// サイドバーからカードをキャンバスへ配置する方法は2種類。
// note/column: HTML5のドラッグ&ドロップで、キャンバス上の好きな位置にドロップして配置する。
// draw: ドラッグ&ドロップではなく「ペンモード」への切り替えスイッチとして働く。
// ペンモード中はキャンバス上をマウスドラッグ/ペンでなぞった軌跡そのものがDrawカードになり、
// Escキーまたはもう一度Drawアイコンを押すとペンモードを終了する。
// image: ドラッグ&ドロップではなく、クリックでOS標準のファイル選択ダイアログを開くスイッチ。
// サイドバー自体は画像データを持たないため、note/columnと同じドラッグ方式にはできない。

// ドラッグ中のカード種別をdataTransferに載せる際のMIMEタイプ(自前の識別子)。
// テキスト形式の他のドラッグ操作と誤って反応しないよう、専用の識別子にしている。
export const CARD_TYPE_DRAG_MIME = "application/x-idea-board-card-type";

type Props = {
  isDrawActive: boolean;
  onToggleDraw: () => void;
  onPickImageFile: (file: File) => void;
};

// キャンバス左端に固定表示するツールサイドバー。
export function Sidebar({
  isDrawActive,
  onToggleDraw,
  onPickImageFile,
}: Props) {
  // Imageアイコンのクリックを、非表示にしたfile inputのクリックへ転送するための参照。
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // 同じファイルを連続で選んでもonChangeが発火するよう、選択後にvalueをリセットする。
    e.target.value = "";
    if (file) onPickImageFile(file);
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        bottom: 0,
        width: 64,
        zIndex: 10,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
        padding: "16px 0",
        background: "#1f2937",
      }}
    >
      <SidebarIcon
        label="Note"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(CARD_TYPE_DRAG_MIME, "note");
          e.dataTransfer.effectAllowed = "copy";
        }}
      >
        <NoteIcon />
      </SidebarIcon>
      <SidebarIcon
        label="Column"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(CARD_TYPE_DRAG_MIME, "column");
          e.dataTransfer.effectAllowed = "copy";
        }}
      >
        <ColumnIcon />
      </SidebarIcon>
      <SidebarIcon label="Image" onClick={() => fileInputRef.current?.click()}>
        <ImageIcon />
      </SidebarIcon>
      <SidebarIcon
        label={isDrawActive ? "ペン中(Escで終了)" : "Draw"}
        active={isDrawActive}
        onClick={onToggleDraw}
      >
        <DrawIcon />
      </SidebarIcon>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleFileInputChange}
      />
    </div>
  );
}

function SidebarIcon({
  label,
  children,
  draggable,
  active,
  onDragStart,
  onClick,
}: {
  label: string;
  children: ReactNode;
  draggable?: boolean;
  active?: boolean;
  onDragStart?: (e: DragEvent<HTMLButtonElement>) => void;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      draggable={draggable}
      onDragStart={onDragStart}
      onClick={onClick}
      title={label}
      style={{
        width: 44,
        height: 44,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 8,
        border: "none",
        background: active ? "#3b82f6" : "#374151",
        color: "#f9fafb",
        cursor: draggable ? "grab" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

// 以下、アイコン用の簡易SVG。外部アイコンライブラリを追加せず、spike内で完結させるため自前で用意する。

function NoteIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <rect
        x="3"
        y="6"
        width="18"
        height="12"
        rx="2"
        stroke="currentColor"
        strokeWidth="2"
      />
      <line
        x1="7"
        y1="11"
        x2="17"
        y2="11"
        stroke="currentColor"
        strokeWidth="2"
      />
      <line
        x1="7"
        y1="15"
        x2="13"
        y2="15"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}

function ColumnIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <rect
        x="3"
        y="3"
        width="18"
        height="18"
        rx="2"
        stroke="currentColor"
        strokeWidth="2"
      />
      <line
        x1="3"
        y1="8"
        x2="21"
        y2="8"
        stroke="currentColor"
        strokeWidth="2"
      />
      <rect
        x="6"
        y="11"
        width="12"
        height="3"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect
        x="6"
        y="16"
        width="12"
        height="3"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <rect
        x="3"
        y="4"
        width="18"
        height="16"
        rx="2"
        stroke="currentColor"
        strokeWidth="2"
      />
      <circle
        cx="8.5"
        cy="9.5"
        r="1.5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M21 15l-5-5-4 4-2-2-5 5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DrawIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path
        d="M4 20l1-4L16 5l3 3L8 19l-4 1z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <line
        x1="14"
        y1="7"
        x2="17"
        y2="10"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}
