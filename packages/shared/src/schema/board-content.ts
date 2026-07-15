import { z } from "zod";

export const CARD_TYPES = ["note", "image", "swatch", "column", "draw"] as const;
export type CardType = (typeof CARD_TYPES)[number];

const baseCardSchema = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

export const noteCardSchema = baseCardSchema.extend({
  type: z.literal("note"),
  text: z.string(),
  color: z.string(),
});

export const imageCardSchema = baseCardSchema.extend({
  type: z.literal("image"),
  src: z.string(),
  caption: z.string().optional(),
});

export const swatchCardSchema = baseCardSchema.extend({
  type: z.literal("swatch"),
  hex: z.string(),
});

export const columnCardSchema = baseCardSchema.extend({
  type: z.literal("column"),
  title: z.string(),
  cardIds: z.array(z.string()),
});

// 1本のストローク＝連続した点の配列。カード自体をドラッグで動かしてもストロークが
// ズレないよう、カードのx,yを原点とした相対座標で保持する。
const strokePointSchema = z.object({ x: z.number(), y: z.number() });
export const strokeSchema = z.array(strokePointSchema);

export const drawCardSchema = baseCardSchema.extend({
  type: z.literal("draw"),
  strokes: z.array(strokeSchema),
});

export const cardSchema = z.discriminatedUnion("type", [
  noteCardSchema,
  imageCardSchema,
  swatchCardSchema,
  columnCardSchema,
  drawCardSchema,
]);
export type Card = z.infer<typeof cardSchema>;

export const cardsSchema = z.array(cardSchema);

export const boardSchema = z.object({
  id: z.string(),
  cards: z.array(cardSchema),
});
export type Board = z.infer<typeof boardSchema>;
