// カード一覧の初期値・localStorage永続化ロジック。
// Konva版(canvas.tsx)とDOM自前実装版(canvas-dom.tsx)が同じボードデータを共有できるよう、
// レンダラーに依存しない部分をここに切り出している。
// packages/shared で定義したzodスキーマ・型をそのままフロントでも使う。
// cardsSchema: カード配列のバリデーション用（localStorageの中身が壊れていないか検証する）
// Card: カード1枚分のTypeScript型（note/image/swatch/columnのunion型）
import { cardsSchema, type Card } from "shared";

// localStorageに保存する際のキー名。ブラウザのlocalStorageは文字列キーで値を出し入れするだけの単純なkey-valueストレージなので、他のアプリのデータと衝突しないよう固有の名前にしている。
export const STORAGE_KEY = "idea-board-spike-cards";

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

// キャンバスの空欄をダブルクリックした時に、その位置へ新しいNoteカードを1枚作るための関数。
export function createNoteCard(x: number, y: number): Card {
  return {
    // crypto.randomUUID(): ブラウザ標準のAPIで、衝突しないランダムなID文字列を生成する。
    // 初期カードのidは"1"/"2"という固定文字列だが、新規作成分は動的に一意なIDが必要なため使用。
    id: crypto.randomUUID(),
    type: "note",
    x,
    y,
    width: 160,
    height: 120,
    text: "新しいメモ",
    color: "#fff2a8",
  };
}
