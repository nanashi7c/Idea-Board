// localStorage/pointer event等ブラウザAPIに依存するため、Client Componentとして実行する。
"use client";

import { useEffect, useRef, useState } from "react";
// packages/sharedで定義したTypeScript型をそのままフロントでも使う。
// Card: カード1枚分の型(note/image/swatch/columnのunion型)
import type { Card } from "shared";
// カード一覧の初期値・localStorage永続化ロジック。Konva版(canvas.tsx)と
// 同じボードデータを共有できるよう、レンダラーに依存しない部分はboard-storage.tsに切り出している。
import { STORAGE_KEY, createNoteCard, loadCards } from "./board-storage";

// 1回のホイール操作あたりの拡大/縮小率。Konva版と同じ値。
const ZOOM_STEP = 1.1;

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
  // 現在テキスト編集中のカードのID。editingIdがセットされている間だけ、
  // 該当カードの中身をdivの代わりに<textarea>にすり替えて表示する(後述)。
  const [editingId, setEditingId] = useState<string | null>(null);

  // cards配列が変わるたびにlocalStorageへ保存する副作用。
  // 依存配列に[cards]を指定しているので、cardsが変化した時だけ実行される。
  // 「保存ボタン」を作らず、状態が変わったら自動で保存する(自動保存)方式にしている。
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
  }, [cards]);

  // キーボードのDelete/Backspaceで選択中のカードを削除するための副作用。
  // カード側のdivは個別にkeydownを拾わせていないため、window全体でキー入力を監視している。
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // テキスト編集中(<textarea>にフォーカスがある状態)にBackspaceを押すと
      // 文字を消したいだけなのにカードごと消えてしまうため、編集中は何もしない。
      if (editingId !== null) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        // filterで「選択中のID以外」だけを残した新しい配列を作り、setCardsに渡す。
        // Reactのstateは直接書き換えず、常に新しい配列/オブジェクトを作って置き換える。
        setCards((prev) => prev.filter((c) => c.id !== selectedId));
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // selectedId/editingIdはhandleKeyDownの中で参照している値なので、依存配列に含める必要がある
    // (含めないと、登録時点の古い値を参照し続けてしまう＝いわゆる「クロージャの罠」)。
  }, [selectedId, editingId]);

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

  // カード単体のドラッグ移動。KONVA_VS_DOM.md「2. ドラッグ」で比較した通り、
  // 素朴にpointermoveのたびにsetCardsを呼ぶと、1秒間に何十回もReactの再レンダリング・
  // cards.map(...)での全カード分の要素再生成・reconcileが走ってしまう。
  // それを避けるため、ドラッグ中はcardRefsから取得した実DOM要素のstyle.left/topを直接書き換え、
  // pointerupで指を離した瞬間に初めてsetCardsでReactのstateへ反映する。
  const handleCardPointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    card: Card,
  ) => {
    if (editingId === card.id) return; // テキスト編集中のtextarea操作はドラッグ扱いにしない
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

  return (
    // containerRef: Konva版のStageに相当する、画面いっぱいの背景。
    // position: fixed + inset: 0で常にビューポート全体を覆い、overflow: hiddenで
    // ワールド側(worldRef)がこの範囲外にはみ出してもスクロールバーが出ないようにしている。
    // touchAction: "none"は、タッチ操作時にブラウザ標準のスクロール/ピンチズームが
    // 自前のパン/ズーム実装と competing しないようにするため。
    <div
      ref={containerRef}
      onWheel={handleWheel}
      onPointerDown={handleBackgroundPointerDown}
      onDoubleClick={handleBackgroundDoubleClick}
      style={{
        position: "fixed",
        inset: 0,
        overflow: "hidden",
        touchAction: "none",
        background: "#f5f5f5",
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
        {/* cardsを1件ずつ描画する。CardTypeはnote/image/swatch/columnの4種類あるが、
            このspikeではnoteとswatchのみ実装済みで、image/columnは未対応のためnullを返し、
            何も描画しない(後で追加実装する余地として型のunionはそのまま残している)。 */}
        {cards.map((card) => {
          if (card.type !== "note" && card.type !== "swatch") return null;
          const isEditing = editingId === card.id;
          return (
            <div
              key={card.id}
              // コールバックref: カードが増減するたびにcardRefs(Map)へ実DOM要素を
              // 登録/削除する。配列ではなくMapを使っているのは、ドラッグ中に
              // 「このcard.idの要素だけ」を高速に取り出すため(handleCardPointerDown参照)。
              ref={(el) => {
                if (el) cardRefs.current.set(card.id, el);
                else cardRefs.current.delete(card.id);
              }}
              // pointerdown: カード単体をドラッグで動かせるようにする(背景側のpanとは別ハンドラ)。
              onPointerDown={(e) => handleCardPointerDown(e, card)}
              // ダブルクリックでテキスト編集モードへ。swatch(色見本)は文字を編集させないので
              // noteのときだけeditingIdをセットする。
              onDoubleClick={() => {
                if (card.type === "note") setEditingId(card.id);
              }}
              style={{
                position: "absolute",
                left: card.x,
                top: card.y,
                width: card.width,
                height: card.height,
                boxSizing: "border-box",
                // note: ユーザーが選んだ付箋の色(card.color)。swatch: 色見本自体の色(card.hex)。
                // 同じdivで2種類のカードの背景を描き分けている。
                background: card.type === "note" ? card.color : card.hex,
                borderRadius: 4,
                // 軽い影を付けてカードが浮いているように見せる(付箋紙らしさの演出)。
                boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
                // 選択中のカードだけ青いoutlineを付けて、選択状態を視覚的に示す。
                // Konva版のstroke(図形の内側に描画される線)と違い、outlineは要素の外側に
                // 重ねて描画されるため、widthやレイアウトに影響しない。
                outline: selectedId === card.id ? "2px solid #3b82f6" : "none",
                // 編集中はテキストカーソル、それ以外はドラッグ可能を示す「掴む」カーソルにする。
                cursor: isEditing ? "text" : "grab",
              }}
            >
              {card.type === "note" &&
                (isEditing ? (
                  // カード自体がDOM要素なので、Konva版のようにtextareaを別要素として重ねて
                  // 位置合わせする必要がなく、カードの中にそのまま置くだけで済む
                  // (KONVA_VS_DOM.md「5. テキスト編集」参照)。
                  <textarea
                    autoFocus
                    defaultValue={card.text}
                    style={{
                      position: "absolute",
                      inset: 0,
                      width: "100%",
                      height: "100%",
                      boxSizing: "border-box",
                      fontSize: 14,
                      padding: 8,
                      border: "2px solid #3b82f6",
                      borderRadius: 4,
                      resize: "none",
                    }}
                    // フォーカスが外れた(編集を終えた)タイミングで初めて確定保存する。
                    // 1文字入力するたびに保存すると重くなる/Undo粒度が細かくなりすぎるため、
                    // 「編集を終えたら1回だけ保存」という方式にしている。
                    onBlur={(e) => {
                      const text = e.target.value;
                      setCards((prev) =>
                        prev.map((c) =>
                          c.id === card.id ? { ...c, text } : c,
                        ),
                      );
                      setEditingId(null);
                    }}
                  />
                ) : (
                  // 非編集時はただのdivとしてテキストを表示するだけ。whiteSpace: "pre-wrap"で
                  // 改行やスペースをそのまま見た目に反映する(textareaでの見た目と揃えるため)。
                  <div
                    style={{ padding: 8, fontSize: 14, whiteSpace: "pre-wrap" }}
                  >
                    {card.text}
                  </div>
                ))}
              {card.type === "swatch" && (
                // swatchは色見本なので、テキストの代わりに16進カラーコード自体を
                // 中央揃えで表示する(noteのテキスト表示とは見た目の目的が異なるため別要素にしている)。
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "100%",
                    height: "100%",
                    color: "#ffffff",
                    fontSize: 13,
                  }}
                >
                  {card.hex}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
