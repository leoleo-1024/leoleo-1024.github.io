import { expect, test, type Page } from '@playwright/test';
import { checker, decodeBlobUrl, makeJpeg, makePng, openImage, toClient, Touch, waitIdle } from './fixtures';

/** L0（元解像度）で現在の履歴を合成した結果の一部 */
async function renderAt(page: Page, x: number, y: number, w = 1, h = 1) {
  return page.evaluate(
    ([x, y, w, h]) => {
      const e = (window as any).__app.getEditor();
      return Array.from(e.renderer.render([...e.history.ops], 0, { x, y, w, h }) as Uint8ClampedArray);
    },
    [x, y, w, h],
  );
}

async function srcAt(page: Page, x: number, y: number) {
  return page.evaluate(
    ([x, y]) => {
      const L = (window as any).__app.getEditor().renderer.levels[0];
      const i = (y * L.w + x) * 4;
      return Array.from(L.data.subarray(i, i + 4));
    },
    [x, y],
  );
}

const opCount = (page: Page) => page.evaluate(() => (window as any).__app.getEditor().history.ops.length);
const state = (page: Page) => page.evaluate(() => (window as any).__app.store.get());

async function dragImage(page: Page, t: Touch, path: Array<[number, number]>, steps = 6) {
  const pts: Array<[number, number]> = [];
  for (const [x, y] of path) pts.push(await toClient(page, x, y));
  await t.drag(pts, steps);
  await waitIdle(page);
}

test.beforeEach(async ({ page }) => {
  await page.goto('./');
});

test('写真を選択して編集画面を表示する', async ({ page }) => {
  await expect(page.getByTestId('open-photo')).toBeVisible();
  await openImage(page, await makePng(600, 400), 'test.png', 'image/png');
  await expect(page.getByTestId('stage')).toBeVisible();
  const s = await state(page);
  expect(s.image).toMatchObject({ name: 'test.png', width: 600, height: 400, hasAlpha: false });
  // 5種類の効果と5つの加工方法
  for (const id of ['gaussianBlur', 'pixelate', 'blackout', 'swirl', 'motionBlur']) await expect(page.getByTestId(`effect-${id}`)).toBeVisible();
  for (const id of ['brush', 'rect', 'ellipse', 'eraser', 'move']) await expect(page.getByTestId(`tool-${id}`)).toBeVisible();
  // タップ領域は 44px 以上
  for (const id of ['undo', 'redo', 'compare', 'save', 'tool-brush', 'effect-swirl']) {
    const b = await page.getByTestId(id).boundingBox();
    expect(b!.height).toBeGreaterThanOrEqual(44);
  }
});

test('縦長・横長・正方形と EXIF の向き', async ({ page }) => {
  for (const [w, h] of [
    [300, 500],
    [500, 300],
    [400, 400],
  ]) {
    await openImage(page, await makePng(w, h), `${w}x${h}.png`, 'image/png');
    expect((await state(page)).image).toMatchObject({ width: w, height: h });
  }
  // Orientation=6（90°回転）の JPEG は縦横が入れ替わる
  await openImage(page, makeJpeg(80, 40, checker, 6), 'rot.jpg', 'image/jpeg');
  expect((await state(page)).image).toMatchObject({ width: 40, height: 80 });
});

test('非対応のファイルはエラーを表示する', async ({ page }) => {
  await page.getByTestId('file-input').setInputFiles({ name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.getByTestId('toast')).toContainText('画像');
  await page.getByTestId('file-input').setInputFiles({ name: 'broken.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('not a jpeg') });
  await expect(page.getByTestId('toast')).toContainText('読み込めません');
  await expect(page.getByTestId('open-photo')).toBeVisible();
});

test('ブラシ：高速になぞっても途切れず、範囲外は変化しない（5種類）', async ({ page }) => {
  await openImage(page, await makePng(600, 400), 'test.png', 'image/png');
  const t = await new Touch(page).init();
  const rows: Record<string, number> = { gaussianBlur: 60, pixelate: 120, blackout: 180, swirl: 240, motionBlur: 300 };
  for (const [eff, y] of Object.entries(rows)) {
    await page.getByTestId(`effect-${eff}`).click();
    // 2ステップで 400px 動かす高速ストローク
    await dragImage(page, t, [
      [100, y],
      [500, y],
    ], 2);
  }
  expect(await opCount(page)).toBe(5);
  for (const [eff, y] of Object.entries(rows)) {
    const after = await renderAt(page, 100, y, 400, 1);
    let changed = 0;
    for (let x = 0; x < 400; x++) {
      const s = await srcAt(page, 100 + x, y);
      if (Math.abs(after[x * 4] - s[0]) + Math.abs(after[x * 4 + 1] - s[1]) > 2) changed++;
    }
    // 渦巻きは中心線上の画素の一部が変化しないことがあるので緩め
    expect(changed, eff).toBeGreaterThan(eff === 'swirl' ? 150 : 300);
  }
  // 黒塗りは完全な黒
  expect(await renderAt(page, 300, 180)).toEqual([0, 0, 0, 255]);
  // どのストロークからも遠い場所は変化しない
  for (const [x, y] of [
    [20, 20],
    [580, 380],
    [300, 30],
  ])
    expect(await renderAt(page, x, y)).toEqual(await srcAt(page, x, y));
});

test('範囲選択：作成・移動・サイズ変更・適用・キャンセル', async ({ page }) => {
  await openImage(page, await makePng(600, 400), 'test.png', 'image/png');
  const t = await new Touch(page).init();
  await page.getByTestId('effect-blackout').click();
  await page.getByTestId('tool-rect').click();
  await expect(page.getByTestId('strength')).toHaveCount(0); // 黒塗りは強さなし
  await expect(page.getByTestId('size')).toHaveCount(0); // 範囲選択はサイズなし
  await dragImage(page, t, [
    [100, 100],
    [300, 250],
  ]);
  await expect(page.getByTestId('apply-selection')).toBeVisible();
  // 適用前のプレビュー（未確定の操作）
  expect(await opCount(page)).toBe(0);
  // 内側をドラッグして移動
  await dragImage(page, t, [
    [200, 175],
    [250, 195],
  ]);
  // 右下のハンドルでサイズ変更
  await dragImage(page, t, [
    [350, 270],
    [400, 300],
  ]);
  await page.getByTestId('apply-selection').click();
  expect(await opCount(page)).toBe(1);
  const shape = await page.evaluate(() => (window as any).__app.getEditor().history.ops[0].shape);
  expect(shape.type).toBe('rect');
  expect(shape.x).toBeCloseTo(150, -1);
  expect(shape.y).toBeCloseTo(120, -1);
  expect(shape.x + shape.w).toBeCloseTo(400, -1);
  expect(shape.y + shape.h).toBeCloseTo(300, -1);
  expect(await renderAt(page, 160, 130)).toEqual([0, 0, 0, 255]);
  expect(await renderAt(page, 390, 290)).toEqual([0, 0, 0, 255]);
  expect(await renderAt(page, 120, 110)).toEqual(await srcAt(page, 120, 110));
  // 楕円・キャンセル
  await page.getByTestId('tool-ellipse').click();
  await page.getByTestId('effect-pixelate').click();
  await dragImage(page, t, [
    [420, 50],
    [580, 150],
  ]);
  await expect(page.getByTestId('cancel-selection')).toBeVisible();
  await page.getByTestId('cancel-selection').click();
  expect(await opCount(page)).toBe(1);
  await waitIdle(page);
  const prev = await page.evaluate(() => {
    const p = (window as any).__app.getEditor().previewPixels();
    const i = (100 * p.w + 500) * 4;
    return Array.from(p.data.subarray(i, i + 4));
  });
  expect(prev).toEqual(await srcAt(page, 500, 100));
});

test('範囲選択中の強さ・方向・角度の変更がプレビューに反映される', async ({ page }) => {
  await openImage(page, await makePng(600, 400), 'test.png', 'image/png');
  const t = await new Touch(page).init();
  await page.getByTestId('effect-swirl').click();
  await page.getByTestId('tool-ellipse').click();
  await dragImage(page, t, [
    [150, 100],
    [450, 300],
  ]);
  const preview = () =>
    page.evaluate(() => {
      const p = (window as any).__app.getEditor().previewPixels();
      let h = 0;
      for (let i = 0; i < p.data.length; i += 97) h = (h * 31 + p.data[i]) >>> 0;
      return h;
    });
  await waitIdle(page);
  const cw = await preview();
  await page.getByTestId('dir-ccw').click();
  await waitIdle(page);
  const ccw = await preview();
  expect(ccw).not.toBe(cw);
  await page.getByTestId('strength').fill('9');
  await waitIdle(page);
  expect(await preview()).not.toBe(ccw);
  await page.getByTestId('apply-selection').click();
  const op = await page.evaluate(() => (window as any).__app.getEditor().history.ops[0]);
  expect(op).toMatchObject({ effect: 'swirl', params: { strength: 9, swirlDirection: 'ccw' } });
  // 適用後に設定を変えても、適用済みの加工は変わらない
  const before = await renderAt(page, 300, 200, 50, 50);
  await page.getByTestId('strength').fill('2');
  await waitIdle(page);
  expect(await renderAt(page, 300, 200, 50, 50)).toEqual(before);
  // モーションブラーの角度表示
  await page.getByTestId('effect-motionBlur').click();
  await page.getByTestId('angle').fill('135');
  await expect(page.getByText('135°')).toBeVisible();
  // 効果ごとに設定が保持される
  await page.getByTestId('effect-swirl').click();
  await expect(page.getByTestId('strength')).toHaveValue('2');
  await expect(page.getByTestId('dir-ccw')).toHaveAttribute('aria-checked', 'true');
});

test('消しゴムと Undo/Redo', async ({ page }) => {
  await openImage(page, await makePng(600, 400), 'test.png', 'image/png');
  const t = await new Touch(page).init();
  await page.getByTestId('effect-blackout').click();
  await dragImage(page, t, [
    [100, 200],
    [500, 200],
  ]);
  await page.getByTestId('effect-pixelate').click();
  await dragImage(page, t, [
    [300, 100],
    [300, 300],
  ]);
  expect(await renderAt(page, 200, 200)).toEqual([0, 0, 0, 255]);
  const mosaic = await renderAt(page, 300, 120);
  expect(mosaic).not.toEqual(await srcAt(page, 300, 120));
  // 消しゴムで黒塗りとモザイクの交差部分を含めて消す
  await page.getByTestId('tool-eraser').click();
  await dragImage(page, t, [
    [200, 200],
    [320, 200],
  ]);
  expect(await renderAt(page, 250, 200)).toEqual(await srcAt(page, 250, 200));
  expect(await renderAt(page, 300, 200)).toEqual(await srcAt(page, 300, 200));
  expect(await renderAt(page, 450, 200)).toEqual([0, 0, 0, 255]);
  expect(await opCount(page)).toBe(3);
  await page.getByTestId('undo').click();
  expect(await renderAt(page, 250, 200)).toEqual([0, 0, 0, 255]);
  await page.getByTestId('undo').click();
  await page.getByTestId('undo').click();
  expect(await renderAt(page, 250, 200)).toEqual(await srcAt(page, 250, 200));
  await expect(page.getByTestId('undo')).toBeDisabled();
  await page.getByTestId('redo').click();
  await page.getByTestId('redo').click();
  await page.getByTestId('redo').click();
  expect(await renderAt(page, 250, 200)).toEqual(await srcAt(page, 250, 200));
  expect(await renderAt(page, 300, 120)).toEqual(mosaic);
  // Undo 後の新しい編集で Redo 履歴は破棄
  await page.getByTestId('undo').click();
  await page.getByTestId('tool-brush').click();
  await dragImage(page, t, [
    [50, 50],
    [60, 60],
  ]);
  await expect(page.getByTestId('redo')).toBeDisabled();
  // プレビューも元に戻っている（消しゴムの位置は再び黒）
  await waitIdle(page);
  const pv = await page.evaluate(() => {
    const p = (window as any).__app.getEditor().previewPixels();
    const i = (200 * p.w + 250) * 4;
    return Array.from(p.data.subarray(i, i + 4));
  });
  expect(pv).toEqual([0, 0, 0, 255]);
});

test('ピンチで拡大し誤描画しない／描画中に2本目の指で取り消し', async ({ page }) => {
  await openImage(page, await makePng(600, 400), 'test.png', 'image/png');
  const t = await new Touch(page).init();
  const box = (await page.getByTestId('stage').boundingBox())!;
  const c: [number, number] = [box.x + box.width / 2, box.y + box.height / 2];
  await t.pinch(c, 60, 240);
  await waitIdle(page);
  expect((await state(page)).zoom).toBeGreaterThan(2.5);
  expect(await opCount(page)).toBe(0);
  await expect(page.getByTestId('fit')).toBeVisible();
  // 描画中に2本目
  await t.start([[c[0] - 50, c[1]]]);
  await t.move([[c[0] - 20, c[1]]]);
  await t.move([[c[0] + 10, c[1]]]);
  await t.start([
    [c[0] + 10, c[1]],
    [c[0] + 80, c[1] + 40],
  ]);
  await t.move([
    [c[0] + 20, c[1]],
    [c[0] + 100, c[1] + 50],
  ]);
  // 1本だけ離しても描画は始まらない
  await t.move([[c[0] + 20, c[1]]]);
  await t.move([[c[0] + 60, c[1] + 10]]);
  await t.end();
  await waitIdle(page);
  expect(await opCount(page)).toBe(0);
  const pv = await page.evaluate(() => {
    const e = (window as any).__app.getEditor();
    const p = e.previewPixels();
    const L = e.renderer.levels[e.pi];
    for (let i = 0; i < p.data.length; i++) if (p.data[i] !== L.data[i]) return false;
    return true;
  });
  expect(pv).toBe(true);
  // 全体表示に戻す
  await page.getByTestId('fit').click();
  expect((await state(page)).zoom).toBe(1);
  // 移動モードでは1本指で移動
  await t.pinch(c, 60, 200);
  await page.getByTestId('tool-move').click();
  const before = await page.evaluate(() => (window as any).__app.getEditor().view.tx);
  await t.drag([c, [c[0] + 80, c[1]]]);
  const after = await page.evaluate(() => (window as any).__app.getEditor().view.tx);
  expect(after - before).toBeGreaterThan(40);
  expect(await opCount(page)).toBe(0);
});

test('拡大中も元画像の正しい位置に加工され、表示範囲は高解像度で描画される', async ({ page }) => {
  await openImage(page, await makePng(4000, 3000, (x, y) => [(x * 7) % 256, (y * 5) % 256, ((x >> 5) * 40) % 256, 255]), 'big.png', 'image/png');
  const pi = await page.evaluate(() => (window as any).__app.getEditor().pi);
  expect(pi).toBe(1); // プレビューは 2000×1500
  // 画像上の (2345, 1678) を中心に 6 倍
  const [cx, cy] = await toClient(page, 2345, 1678);
  const box = (await page.getByTestId('stage').boundingBox())!;
  await page.evaluate(([x, y]) => (window as any).__app.getEditor().zoomTo(6, x, y), [cx - box.x, cy - box.y]);
  await page.waitForTimeout(150);
  await waitIdle(page);
  const detail = await page.evaluate(() => (window as any).__app.getEditor().detailInfo);
  expect(detail?.li).toBe(0);
  const t = await new Touch(page).init();
  await page.getByTestId('effect-blackout').click();
  await dragImage(page, t, [
    [2340, 1678],
    [2350, 1678],
  ]);
  const scale = await page.evaluate(() => (window as any).__app.getEditor().view.scale);
  const r = 16 / scale; // ブラシ半径（元画像px）
  expect(await renderAt(page, 2345, 1678)).toEqual([0, 0, 0, 255]);
  expect(await renderAt(page, 2345, Math.round(1678 + r - 2))).toEqual([0, 0, 0, 255]);
  expect(await renderAt(page, 2345, Math.round(1678 + r + 3))).not.toEqual([0, 0, 0, 255]);
  expect(await renderAt(page, 2345, Math.round(1678 - r - 3))).not.toEqual([0, 0, 0, 255]);
  // 画面上の表示（詳細表示）も同じ位置が黒い
  const shown = await page.evaluate(([x, y]) => {
    const c = document.querySelector('.stage canvas') as HTMLCanvasElement;
    const rect = c.getBoundingClientRect();
    const k = c.width / rect.width;
    const d = c.getContext('2d')!.getImageData(Math.round((x - rect.left) * k), Math.round((y - rect.top) * k), 1, 1).data;
    return Array.from(d);
  }, await toClient(page, 2345, 1678));
  expect(shown).toEqual([0, 0, 0, 255]);
});

test('元画像の比較（長押し）', async ({ page }) => {
  await openImage(page, await makePng(600, 400), 'test.png', 'image/png');
  const t = await new Touch(page).init();
  await page.getByTestId('effect-blackout').click();
  await dragImage(page, t, [
    [100, 200],
    [500, 200],
  ]);
  const b = (await page.getByTestId('compare').boundingBox())!;
  await t.start([[b.x + b.width / 2, b.y + b.height / 2]]);
  await expect(page.getByText('元画像', { exact: true })).toBeVisible();
  expect((await state(page)).comparing).toBe(true);
  await t.end();
  await expect.poll(async () => (await state(page)).comparing).toBe(false);
  expect(await opCount(page)).toBe(1);
});

test('未保存の編集があるときは新しい写真を開く前に確認する', async ({ page }) => {
  await openImage(page, await makePng(600, 400), 'test.png', 'image/png');
  const t = await new Touch(page).init();
  await dragImage(page, t, [
    [100, 200],
    [200, 200],
  ]);
  await page.getByTestId('new-photo').click();
  await expect(page.getByTestId('dialog')).toContainText('保存していない編集');
  await page.getByRole('button', { name: 'キャンセル' }).click();
  await expect(page.getByTestId('dialog')).toHaveCount(0);
  expect(await opCount(page)).toBe(1);
});

async function exportVia(page: Page, format: 'jpeg' | 'png') {
  await page.getByTestId('save').click();
  await page.getByTestId(`format-${format}`).click();
  await page.getByTestId('export-run').click();
  await expect(page.getByTestId('export-preview')).toBeVisible({ timeout: 60_000 });
  const url = await page.getByTestId('export-preview').getAttribute('src');
  const meta = await page.getByTestId('export-meta').textContent();
  return { url: url!, meta: meta! };
}

test('書き出し：5種類の加工が元解像度で反映され、黒塗りに元画素が残らない', async ({ page }) => {
  await openImage(page, await makePng(600, 400), 'IMG_0001.png', 'image/png');
  const t = await new Touch(page).init();
  await page.getByTestId('effect-blackout').click();
  await page.getByTestId('tool-rect').click();
  await dragImage(page, t, [
    [40, 40],
    [200, 120],
  ]);
  await page.getByTestId('apply-selection').click();
  await page.getByTestId('tool-brush').click();
  for (const [eff, y] of [
    ['gaussianBlur', 180],
    ['pixelate', 240],
    ['swirl', 300],
    ['motionBlur', 360],
  ] as const) {
    await page.getByTestId(`effect-${eff}`).click();
    await dragImage(page, t, [
      [250, y],
      [550, y],
    ]);
  }
  const expected = await renderAt(page, 0, 0, 600, 400);
  for (const format of ['png', 'jpeg'] as const) {
    const { url, meta } = await exportVia(page, format);
    expect(meta).toContain(`IMG_0001_edited.${format === 'png' ? 'png' : 'jpg'}`);
    expect(meta).toContain('600 × 400');
    const img = await decodeBlobUrl(page, url);
    expect([img.w, img.h]).toEqual([600, 400]);
    expect(img.type).toBe(format === 'png' ? 'image/png' : 'image/jpeg');
    let sum = 0;
    for (let i = 0; i < expected.length; i++) sum += Math.abs(img.data[i] - expected[i]);
    const mean = sum / expected.length;
    if (format === 'png') expect(mean).toBe(0);
    else expect(mean).toBeLessThan(10);
    // 黒塗りの内側（JPEG は圧縮誤差を考慮して少し内側）
    let maxv = 0;
    for (let y = 48; y < 112; y++)
      for (let x = 48; x < 192; x++) {
        const i = (y * 600 + x) * 4;
        maxv = Math.max(maxv, img.data[i], img.data[i + 1], img.data[i + 2]);
      }
    expect(maxv).toBeLessThanOrEqual(format === 'png' ? 0 : 8);
    await page.getByTestId('export-close').click();
  }
  // 書き出しても編集内容はそのまま
  expect(await opCount(page)).toBe(5);
});

test('PNG の透明度を保持する', async ({ page }) => {
  await openImage(page, await makePng(200, 100, (x, y) => [x, y, 128, x < 100 ? 0 : 255], true), 'alpha.png', 'image/png');
  expect((await state(page)).image.hasAlpha).toBe(true);
  const { url } = await exportVia(page, 'png');
  const img = await decodeBlobUrl(page, url);
  expect(img.data[(50 * 200 + 20) * 4 + 3]).toBe(0);
  expect(img.data[(50 * 200 + 150) * 4 + 3]).toBe(255);
});

test('canvas の上限を超える大きな写真は自前エンコーダーで元解像度のまま書き出す', async ({ page }) => {
  test.setTimeout(240_000);
  const W = 5000;
  const H = 3400; // 1700万画素 > iOS の canvas 上限
  await openImage(page, await makePng(W, H, (x, y) => [(x >> 4) % 256, (y >> 4) % 256, 200, 255]), 'large.png', 'image/png');
  const t = await new Touch(page).init();
  await page.getByTestId('effect-blackout').click();
  await page.getByTestId('tool-rect').click();
  await dragImage(page, t, [
    [1000, 1000],
    [3000, 2000],
  ]);
  await page.getByTestId('apply-selection').click();
  const { url, meta } = await exportVia(page, 'jpeg');
  expect(meta).toContain('5000 × 3400');
  const res = await page.evaluate(async (u) => {
    const b = await (await fetch(u)).blob();
    const bmp = await createImageBitmap(b);
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 400;
    const ctx = c.getContext('2d')!;
    // 黒塗りの中（2000,1500）付近と外（300,300）付近を切り出す
    ctx.drawImage(bmp, 1900, 1400, 200, 200, 0, 0, 200, 200);
    ctx.drawImage(bmp, 200, 200, 200, 200, 200, 200, 200, 200);
    const inside = ctx.getImageData(0, 0, 200, 200).data;
    const outside = ctx.getImageData(200, 200, 1, 1).data;
    let maxv = 0;
    for (let i = 0; i < inside.length; i += 4) maxv = Math.max(maxv, inside[i], inside[i + 1], inside[i + 2]);
    return { w: bmp.width, h: bmp.height, maxv, outside: Array.from(outside), type: b.type };
  }, url);
  expect(res).toMatchObject({ w: W, h: H, type: 'image/jpeg' });
  expect(res.maxv).toBeLessThanOrEqual(4);
  expect(Math.abs(res.outside[2] - 200)).toBeLessThan(8);
  const method = await page.evaluate(() => (window as any).__lastExportMethod);
  expect(method === undefined || method === 'encoder').toBe(true);
});
