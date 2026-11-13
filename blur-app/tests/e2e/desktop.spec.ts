import { expect, test } from '@playwright/test';
import { makePng, openImage, toClient, waitIdle } from './fixtures';

test('PC：マウスで描画・ホイールで拡大・キーボードで Undo/Redo', async ({ page }) => {
  await page.goto('./');
  await openImage(page, await makePng(600, 400), 'pc.png', 'image/png');
  await page.getByTestId('effect-blackout').click();
  const [x0, y0] = await toClient(page, 100, 200);
  const [x1, y1] = await toClient(page, 500, 200);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps: 3 });
  await page.mouse.up();
  await waitIdle(page);
  const ops = () => page.evaluate(() => (window as any).__app.getEditor().history.ops.length);
  expect(await ops()).toBe(1);
  await page.keyboard.press('Control+z');
  expect(await ops()).toBe(0);
  await page.keyboard.press('Control+Shift+z');
  expect(await ops()).toBe(1);
  await page.mouse.move(x0, y0);
  await page.mouse.wheel(0, -400);
  await expect.poll(() => page.evaluate(() => (window as any).__app.store.get().zoom)).toBeGreaterThan(1.5);
  expect(await ops()).toBe(1);
});

test('初回読み込み後はオフラインで起動・編集できる', async ({ page, context }) => {
  await page.goto('./');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('open-photo')).toBeVisible();
  await openImage(page, await makePng(300, 200), 'offline.png', 'image/png');
  await page.getByTestId('effect-blackout').click();
  await page.getByTestId('tool-rect').click();
  const [a, b] = await toClient(page, 50, 50);
  const [c, d] = await toClient(page, 150, 150);
  await page.mouse.move(a, b);
  await page.mouse.down();
  await page.mouse.move(c, d, { steps: 4 });
  await page.mouse.up();
  await page.getByTestId('apply-selection').click();
  await page.getByTestId('save').click();
  await page.getByTestId('export-run').click();
  await expect(page.getByTestId('export-meta')).toContainText('300 × 200');
  // 写真が Service Worker のキャッシュに入っていない
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) urls.push(r.url);
    return urls;
  });
  expect(cached.some((u) => /offline\.png|blob:/.test(u))).toBe(false);
  expect(cached.some((u) => /index\.html/.test(u))).toBe(true);
});
