import { expect, test } from '@playwright/test';
import { makePng, openImage } from './fixtures';

test('共有の失敗・キャンセルで編集内容を失わない', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__shareMode = 'abort';
    (navigator as any).canShare = () => true;
    (navigator as any).share = async () => {
      const mode = (window as any).__shareMode;
      if (mode === 'ok') return;
      throw new DOMException('x', mode === 'abort' ? 'AbortError' : 'NotAllowedError');
    };
  });
  await page.goto('./');
  await openImage(page, await makePng(300, 200), 's.png', 'image/png');
  await page.getByTestId('effect-blackout').click();
  await page.evaluate(() => {
    const e = (window as any).__app.getEditor();
    e.history.push({ id: 99999, kind: 'effect', effect: 'blackout', params: { strength: 5, swirlDirection: 'cw', angle: 0 }, shape: { type: 'rect', x: 10, y: 10, w: 50, h: 50 } });
    (window as any).__app.store.set({ dirty: true, canUndo: true });
  });
  await page.getByTestId('save').click();
  await page.getByTestId('export-run').click();
  await page.getByTestId('export-share').click();
  await expect(page.getByTestId('toast')).toContainText('キャンセル');
  await page.evaluate(() => ((window as any).__shareMode = 'fail'));
  await page.getByTestId('export-share').click();
  await expect(page.getByTestId('toast')).toContainText('共有できませんでした');
  expect((await page.evaluate(() => (window as any).__app.store.get())).dirty).toBe(true);
  await page.evaluate(() => ((window as any).__shareMode = 'ok'));
  await page.getByTestId('export-share').click();
  await expect(page.getByTestId('toast')).toContainText('共有シートでの操作が完了');
  expect((await page.evaluate(() => (window as any).__app.store.get())).dirty).toBe(false);
  expect(await page.evaluate(() => (window as any).__app.getEditor().history.ops.length)).toBe(1);
});

test('メモリ不足で画素を読めないときは縮小して開く選択肢を出す', async ({ page }) => {
  await page.addInitScript(() => {
    // iOS のメモリ不足時の挙動（エラーにならず透明な画素が返る）を最初の読み込みだけ再現
    const orig = CanvasRenderingContext2D.prototype.getImageData;
    let fail = true;
    CanvasRenderingContext2D.prototype.getImageData = function (...args: [number, number, number, number]) {
      const d = orig.apply(this, args);
      if (fail && this.canvas.width === 800) d.data.fill(0);
      return d;
    };
    (window as any).__stopFail = () => (fail = false);
  });
  await page.goto('./');
  await page.getByTestId('file-input').setInputFiles({ name: 'm.png', mimeType: 'image/png', buffer: await makePng(800, 600) });
  await expect(page.getByTestId('dialog')).toContainText('メモリが不足');
  await page.evaluate(() => (window as any).__stopFail());
  await page.getByRole('button', { name: '縮小して開く' }).click();
  await page.waitForFunction(() => (window as any).__app.getEditor() && !(window as any).__app.store.get().busy);
  const info = await page.evaluate(() => (window as any).__app.store.get().image);
  expect(info.reducedFrom).toEqual({ width: 800, height: 600 });
  expect(info.width * info.height).toBeLessThanOrEqual(800 * 600);
});
