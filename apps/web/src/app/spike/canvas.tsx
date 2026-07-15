// Konva（react-konva）はブラウザのCanvas APIに依存するため、
// このコンポーネントはClient Component（ブラウザ側でのみ実行）である必要がある。
"use client";

import { useEffect, useState } from "react";
// react-konva: KonvaというCanvas描画ライブラリをReactのコンポーネントとして使えるようにするラッパー。
// Stage = 描画領域全体（<canvas>要素そのものに相当）
// Layer = Stage内の描画レイヤー（複数重ねられる。今回は1枚だけ使用）
// Group  = 複数の図形をまとめて1つのオブジェクトとして扱う入れ物（カード1枚 = Group 1つ）
// Rect / Text = それぞれ矩形・文字を描画する図形コンポーネント
import { Stage, Layer, Rect, Text, Group } from "react-konva";
// packages/shared で定義したTypeScript型をそのままフロントでも使う。
// Card: カード1枚分の型（note/image/swatch/columnのunion型）
import type { Card } from "shared";
// カード一覧の初期値・localStorage永続化ロジック。DOM自前実装版(canvas-dom.tsx)と
// 同じボードデータを共有できるよう、レンダラーに依存しない部分は board-storage.ts に切り出している。
import { STORAGE_KEY, createNoteCard, loadCards } from "./board-storage";

// spikeページの本体コンポーネント。カードの状態（配列）と、キャンバスの見た目（拡大率・位置）を
// すべてReactのuseStateで持ち、Konva側はその状態を描画するだけ、という設計にしている。
export function SpikeCanvas() {
  // Stageの実ピクセルサイズ（ウィンドウいっぱいに表示するため、画面サイズと同期させる）。
  // SSRではwindowが存在しないため初期値は0にしておき、マウント後のuseEffectで実際の値に更新する。
  const [size, setSize] = useState({ width: 0, height: 0 });
  // キャンバス全体の拡大率（ズーム）。1が等倍。
  const [scale, setScale] = useState(1);
  // キャンバス全体の表示位置（パン）。Stage自体をドラッグして動かした時の位置を保持する。
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  // カード一覧そのもの。ここが「ボードの中身」の実体で、Undo・保存・整列など、
  // 今後追加する機能はすべてこの配列をどう更新するかという話になる。
  // 初期値にloadCards（関数そのもの）を渡しているのは「遅延初期化」というReactの機能で、
  // 初回レンダリング時に1回だけloadCards()が呼ばれる。もし`useState(loadCards())`と書くと
  // 再レンダリングのたびにloadCards()が呼ばれてしまうため、関数を渡す書き方が正しい。
  const [cards, setCards] = useState<Card[]>(loadCards);
  // 現在選択中のカードのID（枠線をハイライトするために使う）。何も選んでいなければnull。
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 現在テキスト編集中のカードのID。Konvaは文字入力欄を持たないため、
  // editingIdがセットされている間だけHTMLの<textarea>をKonvaの上に重ねて表示する（後述）。
  const [editingId, setEditingId] = useState<string | null>(null);

  // ウィンドウサイズが変わった時（リサイズ）にStageのサイズも追従させるための副作用。
  // 依存配列が空[]なので、マウント時に1回だけ登録され、アンマウント時にイベントリスナーを解除する。
  useEffect(() => {
    const updateSize = () =>
      setSize({ width: window.innerWidth, height: window.innerHeight });
    updateSize(); // マウント直後にも一度実行して初期サイズを反映
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  // cards配列が変わるたびにlocalStorageへ保存する副作用。
  // 依存配列に[cards]を指定しているので、cardsが変化した時だけ実行される。
  // 「保存ボタン」を作らず、状態が変わったら自動で保存する（自動保存）方式にしている。
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
  }, [cards]);

  // キーボードのDelete/Backspaceで選択中のカードを削除するための副作用。
  // Konvaの各図形は個別にkeydownを拾えないため、window全体でキー入力を監視している。
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // テキスト編集中（<textarea>にフォーカスがある状態）にBackspaceを押すと
      // 文字を消したいだけなのにカードごと消えてしまうため、編集中は何もしない。
      if (editingId !== null) return; // テキスト編集中は無視
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
    // （含めないと、登録時点の古い値を参照し続けてしまう＝いわゆる「クロージャの罠」）。
  }, [selectedId, editingId]);

  // 現在編集中のカードのオブジェクト本体を取り出しておく（無ければundefined）。
  // JSXの中で何度も使うので、レンダリングのたびに1回だけ計算しておく。
  const editingCard = cards.find((c) => c.id === editingId);

  return (
    // <> </> はReact Fragment。KonvaのStage（Canvas）と、
    // その上に重ねるHTMLの<textarea>を、余分なdivを挟まずに並べて返すために使っている。
    <>
      <Stage
        // Stageの実ピクセルサイズ。ウィンドウサイズに追従（上のuseEffect参照）。
        width={size.width}
        height={size.height}
        // editingId === null の間だけStage自体をドラッグでパンできるようにする。
        // 編集中にキャンバスがズレると使いにくいため、編集中はパンを止める。
        draggable={editingId === null}
        // 拡大率。X/Y同じ値にして縦横比を保ったままズームする。
        scaleX={scale}
        scaleY={scale}
        // Stage自体の表示位置（パンした結果）。state管理下に置くことで、
        // 下の<textarea>のオーバーレイ位置計算にも同じ値を使い回せるようにしている。
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
          const scaleBy = 1.1;
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
        // Stage（背景部分）をドラッグし終えた時に、パン後の位置をstateへ反映する。
        //
        // 【ここが実際にハマったバグの箇所】
        // Konvaのドラッグイベントは、子要素（カードのGroup）から親（Stage）へ「バブリング」
        // （伝播）する。つまりカードをドラッグして離した瞬間、Stage側のonDragEndも
        // 一緒に発火してしまう。以前は `e.target === e.target.getStage()` のガードが無く、
        // 無条件に `setStagePos({ x: e.target.x(), y: e.target.y() })` を実行していたため、
        // e.targetがカード（Group）を指している時にそのカードの座標をstagePos（画面全体の位置）
        // として上書きしてしまい、「カードを動かすと画面ごと動く」という不具合になっていた。
        // 対策として、実際にドラッグされたのがStage自身の時だけ処理するようガードしている。
        onDragEnd={(e) => {
          if (e.target === e.target.getStage()) {
            setStagePos({ x: e.target.x(), y: e.target.y() });
          }
        }}
        // 背景（カード以外の部分）をクリックしたら選択解除する。
        // e.targetはクリックされた実際の図形を指すため、Stage自身がクリックされた時＝
        // カードの外側がクリックされた時、という判定に使える。
        onClick={(e) => {
          if (e.target === e.target.getStage()) setSelectedId(null);
        }}
        onDblClick={(e) => {
          // 背景をダブルクリックしたら、その位置に新しいNoteカードを作る（カード作成のUI）。
          if (e.target !== e.target.getStage()) return; // カード自体のダブルクリックは各カード側で処理
          const stage = e.target.getStage();
          // getRelativePointerPosition(): マウス座標を「Stageの拡大率・パン位置を考慮した上での
          // キャンバス内座標」に変換してくれるKonvaのAPI。ズームやパンをしていても、
          // 常にカード自体の座標系（x, y）でクリック位置を取得できる。
          const pos = stage?.getRelativePointerPosition();
          if (!pos) return;
          const newCard = createNoteCard(pos.x, pos.y);
          setCards((prev) => [...prev, newCard]);
          setSelectedId(newCard.id);
        }}
      >
        <Layer>
          {/* cardsを1件ずつ描画する。CardTypeはnote/image/swatch/columnの4種類あるが、
              このspikeではnoteとswatchのみ実装済みで、image/columnは未対応のためnullを返し、
              何も描画しない（後で追加実装する余地として型のunionはそのまま残している）。 */}
          {cards.map((card) =>
            card.type === "note" || card.type === "swatch" ? (
              <Group
                key={card.id}
                x={card.x}
                y={card.y}
                // draggable: カード単体をドラッグで動かせるようにする（Stage側のdraggableとは別物）。
                draggable
                // クリックで選択状態にする（枠線ハイライトはRect側のstrokeで表現）。
                onClick={() => setSelectedId(card.id)}
                // ダブルクリックでテキスト編集モードへ。swatch（色見本）は文字を編集させないので
                // note のときだけeditingIdをセットする。
                onDblClick={() => {
                  if (card.type === "note") setEditingId(card.id);
                }}
                // ドラッグ終了時、動いた先の座標をcards配列に反映する。
                // 対象カードのみをmapで新しいオブジェクトに差し替え、他のカードはそのまま残す
                // （Reactのstateを直接書き換えないための定型パターン）。
                onDragEnd={(e) => {
                  const { x, y } = e.target.position();
                  setCards((prev) =>
                    prev.map((c) => (c.id === card.id ? { ...c, x, y } : c)),
                  );
                }}
                // カードにマウスが乗ったらカーソルを変える（canvas-dom版のcursor: grab相当）。
                // Konvaは<canvas>1枚に描画しているためCSSのcursorプロパティを図形ごとに
                // 指定できず、Stageのコンテナ要素のstyle.cursorを直接書き換える必要がある。
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
              >
                <Rect
                  width={card.width}
                  height={card.height}
                  // note: ユーザーが選んだ付箋の色（card.color）。swatch: 色見本自体の色（card.hex）。
                  // 同じRectコンポーネントで2種類のカードの背景を描き分けている。
                  fill={card.type === "note" ? card.color : card.hex}
                  // 選択中のカードだけ青い枠線を付けて、選択状態を視覚的に示す。
                  // 未選択時はstrokeWidthを0にすることで線自体を消している（undefinedだけだと
                  // デフォルト値が使われる場合があるため、明示的に0を指定）。
                  stroke={selectedId === card.id ? "#3b82f6" : undefined}
                  strokeWidth={selectedId === card.id ? 2 : 0}
                  cornerRadius={4}
                  // 軽い影を付けてカードが浮いているように見せる（付箋紙らしさの演出）。
                  shadowBlur={4}
                  shadowOpacity={0.2}
                />
                {card.type === "note" && (
                  <Text
                    text={card.text}
                    width={card.width}
                    height={card.height}
                    padding={8}
                    fontSize={14}
                    // 編集中（<textarea>を上に重ねて表示している間）は、下のKonvaのTextを隠す。
                    // 隠さないと、編集用textareaと元のテキストが二重に見えてしまう。
                    visible={editingId !== card.id}
                  />
                )}
                {card.type === "swatch" && (
                  // swatchは色見本なので、テキストの代わりに16進カラーコード自体を
                  // 中央揃えで表示する（noteのTextとは見た目の目的が異なるため別要素にしている）。
                  <Text
                    text={card.hex}
                    width={card.width}
                    height={card.height}
                    align="center"
                    verticalAlign="middle"
                    fontSize={13}
                    fill="#ffffff"
                  />
                )}
              </Group>
            ) : null,
          )}
        </Layer>
      </Stage>

      {editingCard && editingCard.type === "note" && (
        // Konva（Canvas）には文字入力用のUIが無いため、編集中だけ本物のHTML <textarea> を
        // カードの真上に重ねて表示し、あたかもカード自体を編集しているように見せている。
        <textarea
          autoFocus
          defaultValue={editingCard.text}
          style={{
            position: "absolute",
            // カードはKonvaの座標系（拡大率・パン位置に依存しない「素の」座標）を持っているが、
            // <textarea>はHTML側の画面座標で配置する必要がある。そのため
            // 「カードのx,y × scale（ズーム倍率）+ stagePos（パンした分のズレ）」という
            // 変換式で、Konva座標→画面座標に換算している。widthとfontSizeにも同じscaleを
            // 掛けているのは、ズームしてもtextareaがカードの見た目のサイズ・文字サイズと
            // 一致するようにするため。
            top: editingCard.y * scale + stagePos.y,
            left: editingCard.x * scale + stagePos.x,
            width: editingCard.width * scale,
            height: editingCard.height * scale,
            fontSize: 14 * scale,
            padding: 8,
            border: "2px solid #3b82f6",
            borderRadius: 4,
            resize: "none",
          }}
          // フォーカスが外れた（編集を終えた）タイミングで初めて確定保存する。
          // 1文字入力するたびに保存すると重くなる／Undo粒度が細かくなりすぎるため、
          // 「編集を終えたら1回だけ保存」という方式にしている。
          onBlur={(e) => {
            const text = e.target.value;
            setCards((prev) =>
              prev.map((c) => (c.id === editingCard.id ? { ...c, text } : c)),
            );
            setEditingId(null);
          }}
        />
      )}
    </>
  );
}
