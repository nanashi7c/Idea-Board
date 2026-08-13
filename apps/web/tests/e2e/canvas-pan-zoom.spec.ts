import test, { expect, Locator } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/board");
});

test("キャンバスを表示する", async ({ page }) => {
  const canvasRegion = page.getByRole("region", {
    name: "アイデアボードのキャンバス",
  });

  await expect(canvasRegion).toBeVisible();

  const canvas = canvasRegion.locator("canvas").first();

  await expect(canvas).toBeVisible();

  await expect.poll(() => getShortestSide(canvas)).toBeGreaterThan(1);
});

test("ホイール操作でキャンバスをズームする", async ({ page }) => {
  const canvas = page
    .getByRole("region", {
      name: "アイデアボードのキャンバス",
    })
    .locator("canvas")
    .first();

  await expect(canvas).toBeVisible();
  await expect.poll(() => getShortestSide(canvas)).toBeGreaterThan(1);

  const center = await getCanvasCenter(canvas);
  const beforeZoom = await canvas.screenshot();

  await page.mouse.move(center.x, center.y);
  await page.mouse.wheel(0, -100);

  await expect
    .poll(async () => canvas.screenshot(), {
      message: "ホイール操作後にキャンバスの描画が変化する",
    })
    .not.toEqual(beforeZoom);
});

test("中ボタンドラッグでキャンバスを移動する", async ({ page }) => {
  const canvas = page
    .getByRole("region", {
      name: "アイデアボードのキャンバス",
    })
    .locator("canvas")
    .first();

  await expect(canvas).toBeVisible();
  await expect.poll(() => getShortestSide(canvas)).toBeGreaterThan(1);
  const center = await getCanvasCenter(canvas);
  const beforePan = await canvas.screenshot();

  await page.mouse.move(center.x, center.y);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(center.x + 80, center.y + 40, { steps: 5 });
  await page.mouse.up({ button: "middle" });

  await expect
    .poll(async () => canvas.screenshot(), {
      message: "中ボタンドラッグ後にキャンバスの描画が変化する",
    })
    .not.toEqual(beforePan);
});

async function getShortestSide(canvas: Locator): Promise<number> {
  const bounds = await canvas.boundingBox();

  if (!bounds) {
    return 0;
  }

  return Math.min(bounds.width, bounds.height);
}

async function getCanvasCenter(
  canvas: Locator,
): Promise<{ x: number; y: number }> {
  const bounds = await canvas.boundingBox();

  if (!bounds) {
    throw new Error("キャンバスの表示領域を取得できませんでした");
  }

  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
}
