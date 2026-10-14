import type { Page } from '@playwright/test';
import { canvasToClient, createProjectWithImages, expect, getDoc, test } from './fixtures';

/** CDP で 2 本指のタッチ操作（ピンチ・回転）を送る */
async function pinch(page: Page, cx: number, cy: number, r0: number, r1: number, a0: number, a1: number) {
  const cdp = await page.context().newCDPSession(page);
  const pts = (r: number, a: number) => [
    { x: cx - r * Math.cos(a), y: cy - r * Math.sin(a), id: 1 },
    { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), id: 2 },
  ];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pts(r0, a0)[0]] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(r0, a0) });
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(r0 + (r1 - r0) * t, a0 + (a1 - a0) * t) });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function touchDrag(page: Page, x0: number, y0: number, x1: number, y1: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0, id: 1 }] });
  for (let i = 1; i <= 8; i++) {
    const t = i / 8;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, id: 1 }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test('写真を複数追加 → タッチで移動・ピンチ・回転 → Undo/Redo', async ({ page, fixtures }) => {
  await createProjectWithImages(page, [fixtures['red-landscape.jpg'], fixtures['blue-portrait.png'], fixtures['green-square.webp']]);
  let { doc } = await getDoc(page);
  expect(doc.imageLayers).toHaveLength(3);
  // 元画像の比率を保って配置されている
  const ratios = doc.imageLayers.map((l: any) => +(l.width / l.height).toFixed(2));
  expect(ratios).toEqual([1.33, 0.67, 1]);

  // 1 本指ドラッグで移動
  const target = doc.imageLayers[0];
  const from = await canvasToClient(page, target.x, target.y);
  await touchDrag(page, from.x, from.y, from.x + 40, from.y + 60);
  ({ doc } = await getDoc(page));
  const moved = doc.imageLayers.find((l: any) => l.id === target.id);
  expect(moved.x - target.x).toBeCloseTo(40 / from.scale, 0);
  expect(moved.y - target.y).toBeCloseTo(60 / from.scale, 0);
  expect((await getDoc(page)).selectedId).toBe(target.id);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  // 2 本指ピンチで 2 倍・30°回転
  const c = await canvasToClient(page, moved.x, moved.y);
  await pinch(page, c.x, c.y, 30, 60, 0, Math.PI / 6);
  ({ doc } = await getDoc(page));
  const pinched = doc.imageLayers.find((l: any) => l.id === target.id);
  expect(pinched.width / moved.width).toBeCloseTo(2, 1);
  expect(pinched.rotation).toBeCloseTo(30, 0);
  expect(pinched.width / pinched.height).toBeCloseTo(moved.width / moved.height, 3);

  // Undo で 1 操作ずつ戻る（ドラッグ 1 回 = 1 履歴）
  await page.getByRole('button', { name: '元に戻す' }).click();
  ({ doc } = await getDoc(page));
  expect(doc.imageLayers.find((l: any) => l.id === target.id).width).toBeCloseTo(moved.width, 3);
  await page.getByRole('button', { name: '元に戻す' }).click();
  ({ doc } = await getDoc(page));
  expect(doc.imageLayers.find((l: any) => l.id === target.id).x).toBeCloseTo(target.x, 3);
  await page.getByRole('button', { name: 'やり直し' }).click();
  ({ doc } = await getDoc(page));
  expect(doc.imageLayers.find((l: any) => l.id === target.id).x).toBeCloseTo(moved.x, 3);

  // 空白部分のタップで選択解除
  const empty = await canvasToClient(page, 20, doc.canvasHeight - 20);
  await page.touchscreen.tap(empty.x, empty.y);
  expect((await getDoc(page)).selectedId).toBeNull();
});

test('画像の削除・複製・反転・重なり順・背景色の変更', async ({ page, fixtures }) => {
  await createProjectWithImages(page, [fixtures['red-landscape.jpg'], fixtures['blue-portrait.png']]);
  let { doc } = await getDoc(page);
  const first = doc.imageLayers[0];
  const p = await canvasToClient(page, first.x, first.y);
  await page.touchscreen.tap(p.x, p.y);
  await expect(page.getByRole('button', { name: '左右反転' })).toBeVisible();

  await page.getByRole('button', { name: '左右反転' }).click();
  await page.getByRole('button', { name: '複製' }).click();
  ({ doc } = await getDoc(page));
  expect(doc.imageLayers).toHaveLength(3);
  expect(doc.imageLayers[0].flipX).toBe(true);
  const copy = doc.imageLayers.find((l: any) => l.id !== first.id && l.assetId === first.assetId);
  expect(copy).toBeTruthy();

  await page.getByRole('button', { name: '重なり', exact: true }).click();
  await page.getByRole('button', { name: '最背面' }).click();
  ({ doc } = await getDoc(page));
  expect(doc.imageLayers.find((l: any) => l.id === copy.id).zIndex).toBe(0);

  await page.getByRole('button', { name: '編集', exact: true }).click();
  await page.getByRole('button', { name: '削除' }).click();
  ({ doc } = await getDoc(page));
  expect(doc.imageLayers).toHaveLength(2);

  await page.getByRole('button', { name: '背景', exact: true }).click();
  await page.getByRole('button', { name: '背景色 #ffd1dc' }).click();
  ({ doc } = await getDoc(page));
  expect(doc.background).toEqual({ type: 'color', color: '#ffd1dc' });
});

test('グリッド・モザイクのレイアウトと表示範囲の調整', async ({ page, fixtures }) => {
  await createProjectWithImages(page, [fixtures['red-landscape.jpg'], fixtures['blue-portrait.png'], fixtures['green-square.webp']]);
  await page.getByRole('button', { name: 'レイアウト' }).click();
  await page.getByRole('tab', { name: 'グリッド' }).click();
  let { doc } = await getDoc(page);
  expect(doc.layoutMode).toBe('grid');
  // 全セルが同じサイズ・回転なし
  const sizes = new Set(doc.imageLayers.map((l: any) => `${l.width.toFixed(1)}x${l.height.toFixed(1)}`));
  expect(sizes.size).toBe(1);
  expect(doc.imageLayers.every((l: any) => l.rotation === 0)).toBe(true);

  // セル内ドラッグは位置ではなく表示範囲を動かす
  await page.getByRole('button', { name: '列を増やす' }).click();
  ({ doc } = await getDoc(page));
  const l0 = doc.imageLayers[0];
  const c = await canvasToClient(page, l0.x, l0.y);
  await touchDrag(page, c.x, c.y, c.x + 30, c.y);
  ({ doc } = await getDoc(page));
  const after = doc.imageLayers[0];
  expect(after.x).toBeCloseTo(l0.x, 3);
  expect(after.fit.focusX).not.toBeCloseTo(l0.fit.focusX, 3);

  await page.getByRole('tab', { name: 'モザイク' }).click();
  ({ doc } = await getDoc(page));
  expect(doc.layoutMode).toBe('mosaic');
  const before = JSON.stringify(doc.imageLayers.map((l: any) => [l.x, l.y, l.width, l.height]));
  await page.getByRole('button', { name: 'レイアウトを再生成' }).click();
  ({ doc } = await getDoc(page));
  expect(JSON.stringify(doc.imageLayers.map((l: any) => [l.x, l.y, l.width, l.height]))).not.toBe(before);
});

test('EXIF の向き情報を反映して読み込む', async ({ page, fixtures }) => {
  await createProjectWithImages(page, [fixtures['exif-rotated.jpg']]);
  const { assets, doc } = await getDoc(page);
  expect(assets[0].w).toBe(200);
  expect(assets[0].h).toBe(300);
  expect(doc.imageLayers[0].width / doc.imageLayers[0].height).toBeCloseTo(200 / 300, 2);
});

test('1179×2556 で書き出し、編集画面と一致し、UI が映り込まない', async ({ page, fixtures }) => {
  await createProjectWithImages(page, [fixtures['red-landscape.jpg'], fixtures['blue-portrait.png'], fixtures['green-square.webp']]);
  // 回転・角丸・不透明度・反転を含む状態にする
  await page.evaluate(() => {
    const s = (window as any).__editor.getState();
    s.commit((d: any) => ({
      ...d,
      background: { type: 'gradient', from: '#ff9a9e', to: '#203a43', angle: 160 },
      imageLayers: d.imageLayers.map((l: any, i: number) => ({
        ...l,
        rotation: i * 17 - 10,
        borderRadius: i * 40,
        opacity: i === 2 ? 0.7 : 1,
        flipX: i === 1,
        x: l.x + i * 30,
      })),
    }));
    s.select(s.doc.imageLayers[0].id); // 選択枠を表示した状態で書き出す
  });
  await page.waitForTimeout(300);

  // 編集画面の描画（UI レイヤーを除く）を出力サイズで取得
  const editorPng: string = await page.evaluate(() => (window as any).__collageStage.toDataURL());

  await page.getByRole('button', { name: '保存・書き出し' }).click();
  await expect(page.getByTestId('output-size')).toHaveText('1179 × 2556 px');
  // 書き出し画面を開くと自動で書き出しが始まる
  await expect(page.getByTestId('export-result')).toContainText('PNG', { timeout: 30_000 });

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('download-button').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  const buf = await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c as Buffer[]));
  expect(buf.subarray(1, 4).toString()).toBe('PNG');
  expect(buf.readUInt32BE(16)).toBe(1179);
  expect(buf.readUInt32BE(20)).toBe(2556);

  // 書き出し画像と編集画面の描画をピクセル比較
  const diff = await page.evaluate(
    async ({ editorPng, exported }) => {
      const load = (src: string) =>
        new Promise<HTMLImageElement>((res, rej) => {
          const i = new Image();
          i.onload = () => res(i);
          i.onerror = rej;
          i.src = src;
        });
      const [a, b] = await Promise.all([load(editorPng), load(exported)]);
      const W = 1179;
      const H = 2556;
      const read = (img: HTMLImageElement) => {
        const c = document.createElement('canvas');
        c.width = W;
        c.height = H;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(img, 0, 0, W, H);
        return ctx.getImageData(0, 0, W, H).data;
      };
      const da = read(a);
      const db = read(b);
      let sum = 0;
      let big = 0;
      for (let i = 0; i < da.length; i += 4) {
        const d = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
        sum += d / 3;
        if (d / 3 > 40) big++;
      }
      return { mean: sum / (W * H), bigRatio: big / (W * H), editorW: a.naturalWidth, editorH: a.naturalHeight };
    },
    { editorPng, exported: `data:image/png;base64,${buf.toString('base64')}` },
  );
  console.log('pixel diff', diff);
  expect(Math.abs(diff.editorW - 1179)).toBeLessThanOrEqual(1); // 編集画面側はステージの丸め誤差で ±1px
  expect(diff.mean).toBeLessThan(2);
  // 選択枠（青）などの UI が映り込んでいれば、大きく異なる画素が増える
  expect(diff.bigRatio).toBeLessThan(0.003);
});

test('アプリを再起動しても保存済みプロジェクトを再編集できる', async ({ page, fixtures }) => {
  await createProjectWithImages(page, [fixtures['red-landscape.jpg'], fixtures['blue-portrait.png']]);
  await page.evaluate(() => {
    const s = (window as any).__editor.getState();
    s.commit((d: any) => ({ ...d, background: { type: 'color', color: '#00ff00' }, imageLayers: d.imageLayers.map((l: any) => ({ ...l, rotation: 12 })) }));
  });
  const { doc: before } = await getDoc(page);
  await page.waitForTimeout(1200); // 自動保存
  const url = page.url();
  await page.reload();
  await expect(page.getByTestId('canvas-container')).toBeVisible();
  const { doc: after } = await getDoc(page);
  expect(after.background).toEqual({ type: 'color', color: '#00ff00' });
  expect(after.imageLayers).toEqual(before.imageLayers);

  // ホームの一覧からも開ける
  await page.getByRole('button', { name: '戻る' }).click();
  await expect(page.getByRole('button', { name: '前回の編集を再開' })).toBeVisible();
  await page.getByRole('button', { name: '前回の編集を再開' }).click();
  await expect(page).toHaveURL(url);
  expect((await getDoc(page)).doc.imageLayers).toHaveLength(2);
});

test('プレビュー画面（ロック画面・ホーム画面・画像のみ）', async ({ page, fixtures }) => {
  await createProjectWithImages(page, [fixtures['red-landscape.jpg']]);
  await page.getByRole('button', { name: 'プレビュー' }).click();
  await expect(page.getByText('時計の領域（目安）')).toBeVisible();
  await page.getByRole('tab', { name: 'ホーム画面' }).click();
  await expect(page.getByText('Dock（目安）')).toBeVisible();
  await page.getByLabel('ガイドを表示').uncheck();
  await expect(page.getByText('Dock（目安）')).toHaveCount(0);
  await page.getByRole('tab', { name: '画像のみ' }).click();
  // プレビューの canvas が描画されている（背景色以外の画素がある）
  await page.waitForTimeout(500);
  const painted = await page.evaluate(() => {
    const c = document.querySelector('[data-testid="preview-canvas"]') as HTMLCanvasElement;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let red = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 80) red++;
    return { w: c.width, red };
  });
  expect(painted.w).toBeGreaterThan(0);
  expect(painted.red).toBeGreaterThan(100);
});

test('非対応ファイルではエラー内容と対処法を表示する', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: '新しい壁紙を作成' }).click();
  await page.getByTestId('file-input').setInputFiles({ name: 'broken.heic', mimeType: 'image/heic', buffer: Buffer.from('not an image') });
  await expect(page.getByRole('alert')).toContainText('HEIC');
  await expect(page.getByTestId('selected-count')).toHaveText('選択中：0枚');
});

test('タッチでハンドルを操作して拡大できる', async ({ page, fixtures }) => {
  await createProjectWithImages(page, [fixtures['red-landscape.jpg']]);
  let { doc } = await getDoc(page);
  const l = doc.imageLayers[0];
  const c = await canvasToClient(page, l.x, l.y);
  await page.touchscreen.tap(c.x, c.y);
  await page.waitForTimeout(300); // 編集パネルが開いてキャンバスが縮む
  ({ doc } = await getDoc(page));
  const corner = await canvasToClient(page, l.x - l.width / 2, l.y - l.height / 2);
  await touchDrag(page, corner.x, corner.y, corner.x - 30, corner.y - 22);
  ({ doc } = await getDoc(page));
  const r = doc.imageLayers[0];
  expect(r.width).toBeGreaterThan(l.width * 1.1);
  expect(r.width / r.height).toBeCloseTo(l.width / l.height, 2);
});

test('50枚の画像を追加して編集・書き出しできる', async ({ page, fixtures }) => {
  test.setTimeout(180_000);
  const { readFileSync } = await import('node:fs');
  const jpg = readFileSync(fixtures['red-landscape.jpg']);
  const png = readFileSync(fixtures['blue-portrait.png']);
  await page.goto('./');
  await page.getByRole('button', { name: '新しい壁紙を作成' }).click();
  const files = Array.from({ length: 50 }, (_, i) =>
    i % 2 ? { name: `p${i}.png`, mimeType: 'image/png', buffer: png } : { name: `j${i}.jpg`, mimeType: 'image/jpeg', buffer: jpg },
  );
  const t0 = Date.now();
  await page.getByTestId('file-input').setInputFiles(files);
  await expect(page.getByTestId('selected-count')).toHaveText('選択中：50枚', { timeout: 120_000 });
  console.log('import 50 images ms', Date.now() - t0);
  await page.getByRole('button', { name: '編集へ進む' }).click();
  await page.waitForTimeout(800);
  let { doc } = await getDoc(page);
  expect(doc.imageLayers).toHaveLength(50);
  const l = doc.imageLayers[49];
  const c = await canvasToClient(page, l.x, l.y);
  const t1 = Date.now();
  await touchDrag(page, c.x, c.y, c.x + 20, c.y + 20);
  console.log('drag ms', Date.now() - t1);
  ({ doc } = await getDoc(page));
  expect(doc.imageLayers[49].x).not.toBeCloseTo(l.x, 1);
  await page.getByRole('button', { name: 'レイアウト' }).click();
  await page.getByRole('tab', { name: 'グリッド' }).click();
  await page.getByRole('button', { name: '保存・書き出し' }).click();
  const t2 = Date.now();
  await expect(page.getByTestId('export-result')).toBeVisible({ timeout: 60_000 });
  console.log('export 50 images ms', Date.now() - t2);
});

test('大きな画像（4000×3000）を縦横比を保って読み込み、JPEGで書き出せる', async ({ page }) => {
  await page.goto('./');
  // 細かい縞模様の大きな JPEG をブラウザ内で生成
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 4000;
    c.height = 3000;
    const ctx = c.getContext('2d')!;
    for (let x = 0; x < 4000; x += 4) {
      ctx.fillStyle = (x / 4) % 2 ? '#000' : '#fff';
      ctx.fillRect(x, 0, 4, 3000);
    }
    ctx.fillStyle = '#e53935';
    ctx.fillRect(0, 0, 2000, 1500);
    return c.toDataURL('image/jpeg', 0.9).split(',')[1];
  });
  await page.getByRole('button', { name: '新しい壁紙を作成' }).click();
  await page.getByTestId('file-input').setInputFiles({ name: 'big.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') });
  await expect(page.getByTestId('selected-count')).toHaveText('選択中：1枚', { timeout: 30_000 });
  await page.getByRole('button', { name: '編集へ進む' }).click();
  await page.waitForTimeout(500);
  const { doc, assets } = await getDoc(page);
  expect(assets[0].w).toBe(4000);
  expect(assets[0].h).toBe(3000);
  expect(doc.imageLayers[0].width / doc.imageLayers[0].height).toBeCloseTo(4 / 3, 3);

  // 回転させて小さく配置した状態で JPEG 書き出し
  await page.evaluate(() => {
    const s = (window as any).__editor.getState();
    s.commit((d: any) => ({ ...d, imageLayers: d.imageLayers.map((l: any) => ({ ...l, rotation: 23, width: l.width * 0.5, height: l.height * 0.5 })) }));
  });
  await page.getByRole('button', { name: '保存・書き出し' }).click();
  // まず保存済みの形式（PNG）で自動書き出しされ、JPEG に切り替えると自動で書き出し直す
  await expect(page.getByTestId('export-result')).toContainText('PNG', { timeout: 30_000 });
  await page.getByRole('tab', { name: 'JPEG（軽量）' }).click();
  await expect(page.getByTestId('export-result')).toContainText('JPEG', { timeout: 30_000 });
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('download-button').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.jpg$/);
  const buf = await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c as Buffer[]));
  expect([buf[0], buf[1], buf[2]]).toEqual([0xff, 0xd8, 0xff]);
  const size = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/jpeg;base64,${b64}`;
    await img.decode();
    return [img.naturalWidth, img.naturalHeight];
  }, buf.toString('base64'));
  expect(size).toEqual([1179, 2556]);
});

test('プロジェクトをバックアップに書き出し、別のプロジェクトとして復元できる', async ({ page, fixtures }) => {
  await createProjectWithImages(page, [fixtures['red-landscape.jpg'], fixtures['blue-portrait.png']]);
  await page.evaluate(() => {
    const s = (window as any).__editor.getState();
    s.commit((d: any) => ({
      ...d,
      background: { type: 'color', color: '#ff00aa' },
      imageLayers: d.imageLayers.map((l: any, i: number) => ({ ...l, rotation: 10 + i, borderRadius: 30 })),
    }));
  });
  const { doc: original } = await getDoc(page);
  await page.getByRole('button', { name: '戻る' }).click();

  // ホームのメニューからバックアップを書き出す
  await page.getByRole('button', { name: /のメニュー$/ }).first().click();
  await page.getByRole('button', { name: 'バックアップを書き出す' }).click();
  await expect(page.getByRole('dialog', { name: 'バックアップの保存' })).toBeVisible({ timeout: 30_000 });
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('backup-download').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^collage-backup-.*\.zip$/);
  const zipPath = await download.path();

  // 復元すると 2 つ目のプロジェクトとして追加される
  await page.getByTestId('backup-input').setInputFiles(zipPath);
  await expect(page.getByText(/を復元しました（2枚）/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: /を開く$/ })).toHaveCount(2);

  // 復元したプロジェクト（一覧の先頭＝最新）を開いて内容を確認
  await page.getByRole('button', { name: /を開く$/ }).first().click();
  await expect(page.getByTestId('canvas-container')).toBeVisible();
  await page.waitForTimeout(500);
  const { doc: restored, assets } = await getDoc(page);
  expect(restored.background).toEqual({ type: 'color', color: '#ff00aa' });
  expect(restored.imageLayers.map((l: any) => [l.rotation, l.borderRadius, Math.round(l.x), Math.round(l.width)])).toEqual(
    original.imageLayers.map((l: any) => [l.rotation, l.borderRadius, Math.round(l.x), Math.round(l.width)]),
  );
  expect(restored.imageLayers[0].assetId).not.toBe(original.imageLayers[0].assetId);
  expect(assets.map((a: any) => [a.w, a.h]).sort()).toEqual([
    [600, 900],
    [800, 600],
  ]);

  // 復元したプロジェクトも書き出せる
  await page.getByRole('button', { name: '保存・書き出し' }).click();
  await expect(page.getByTestId('export-result')).toContainText('1179 × 2556', { timeout: 30_000 });
});

test('壊れたバックアップファイルはエラー内容を表示し、データを追加しない', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('backup-input').setInputFiles({ name: 'broken.zip', mimeType: 'application/zip', buffer: Buffer.from('this is not a zip') });
  await expect(page.getByRole('alert')).toContainText('バックアップファイルを読み込めませんでした');
  await expect(page.getByText('まだプロジェクトはありません')).toBeVisible();
});
