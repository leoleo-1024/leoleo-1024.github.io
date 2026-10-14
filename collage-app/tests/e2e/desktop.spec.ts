import { canvasToClient, createProjectWithImages, expect, getDoc, test } from './fixtures';

test('PC：マウスで移動・ハンドルで拡大・キーボードで Undo/削除', async ({ page, fixtures }) => {
  await createProjectWithImages(page, [fixtures['red-landscape.jpg'], fixtures['blue-portrait.png']]);
  let { doc } = await getDoc(page);
  const l = doc.imageLayers[0];
  const c = await canvasToClient(page, l.x, l.y);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 50, c.y + 20, { steps: 6 });
  await page.mouse.up();
  ({ doc } = await getDoc(page));
  const moved = doc.imageLayers[0];
  expect(moved.x - l.x).toBeCloseTo(50 / c.scale, 0);

  // 右下のハンドルをドラッグして拡大（縦横比は維持）
  const corner = await canvasToClient(page, moved.x + moved.width / 2, moved.y + moved.height / 2);
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(corner.x + 40, corner.y + 30, { steps: 6 });
  await page.mouse.up();
  ({ doc } = await getDoc(page));
  const resized = doc.imageLayers[0];
  expect(resized.width).toBeGreaterThan(moved.width * 1.1);
  expect(resized.width / resized.height).toBeCloseTo(moved.width / moved.height, 2);

  await page.keyboard.press('Control+z');
  ({ doc } = await getDoc(page));
  expect(doc.imageLayers[0].width).toBeCloseTo(moved.width, 3);

  await page.keyboard.press('Delete');
  ({ doc } = await getDoc(page));
  expect(doc.imageLayers).toHaveLength(1);
});

test('PWA：一度読み込めばオフラインでも起動できる', async ({ page, context }) => {
  await page.goto('./');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload(); // Service Worker の制御下に入る
  await expect(page.getByRole('button', { name: '新しい壁紙を作成' })).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('button', { name: '新しい壁紙を作成' })).toBeVisible();
  await context.setOffline(false);
});
