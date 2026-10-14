import { test as base, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

export const FIXTURE_DIR = path.join(import.meta.dirname, '.fixtures');

/** ブラウザの canvas でテスト画像を生成し、ファイルとして保存する */
export async function makeFixtures(page: Page): Promise<Record<string, string>> {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const specs = [
    { name: 'red-landscape.jpg', w: 800, h: 600, type: 'image/jpeg', colors: ['#e53935', '#ffeb3b'] },
    { name: 'blue-portrait.png', w: 600, h: 900, type: 'image/png', colors: ['#1e88e5', '#00e5ff'] },
    { name: 'green-square.webp', w: 700, h: 700, type: 'image/webp', colors: ['#43a047', '#c6ff00'] },
    { name: 'orient-src.jpg', w: 300, h: 200, type: 'image/jpeg', colors: ['#ff0000', '#0000ff'] },
  ];
  const out: Record<string, string> = {};
  for (const s of specs) {
    const file = path.join(FIXTURE_DIR, s.name);
    out[s.name] = file;
    if (existsSync(file)) continue;
    const b64 = await page.evaluate(({ w, h, type, colors }) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d')!;
      // 左半分と右半分を塗り分け、向きが判別できるようにする
      ctx.fillStyle = colors[0];
      ctx.fillRect(0, 0, w / 2, h);
      ctx.fillStyle = colors[1];
      ctx.fillRect(w / 2, 0, w / 2, h);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(w * 0.1, h * 0.1, w * 0.1, h * 0.1);
      return c.toDataURL(type, 0.95).split(',')[1];
    }, s);
    writeFileSync(file, Buffer.from(b64, 'base64'));
  }
  // EXIF Orientation=6（90°回転）を付与した JPEG：表示上は 200×300 の縦長になる
  const rotated = path.join(FIXTURE_DIR, 'exif-rotated.jpg');
  out['exif-rotated.jpg'] = rotated;
  if (!existsSync(rotated)) {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(out['orient-src.jpg']);
    const exif = Buffer.from([
      0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01, 0x01, 0x12,
      0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    writeFileSync(rotated, Buffer.concat([src.subarray(0, 2), exif, src.subarray(2)]));
  }
  return out;
}

export interface LayerInfo {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  visible: boolean;
  assetId: string;
}

export async function getDoc(page: Page) {
  return page.evaluate(() => {
    const s = (window as any).__editor.getState();
    return { doc: s.doc, selectedId: s.selectedId, assets: s.assets ? Object.values(s.assets).map((a: any) => ({ id: a.id, w: a.originalWidth, h: a.originalHeight, name: a.name })) : [], past: s.history.past.length };
  });
}

/** キャンバス座標 → 画面座標 */
export async function canvasToClient(page: Page, x: number, y: number) {
  return page.evaluate(
    ({ x, y }) => {
      const s = (window as any).__editor.getState();
      const el = document.querySelector('[data-testid="canvas-container"]') as HTMLElement;
      const r = el.getBoundingClientRect();
      const M = 20;
      const scale = Math.min((r.width - M * 2) / s.doc.canvasWidth, (r.height - M * 2) / s.doc.canvasHeight);
      const ox = (r.width - s.doc.canvasWidth * scale) / 2;
      const oy = (r.height - s.doc.canvasHeight * scale) / 2;
      return { x: r.left + ox + x * scale, y: r.top + oy + y * scale, scale };
    },
    { x, y },
  );
}

export async function createProjectWithImages(page: Page, files: string[]) {
  await page.goto('./');
  await page.getByRole('button', { name: '新しい壁紙を作成' }).click();
  await expect(page.getByText('画像を選択')).toBeVisible();
  await page.getByTestId('file-input').setInputFiles(files);
  await expect(page.getByTestId('selected-count')).toHaveText(`選択中：${files.length}枚`, { timeout: 20_000 });
  await page.getByRole('button', { name: '編集へ進む' }).click();
  await expect(page.getByTestId('canvas-container')).toBeVisible();
  // プレビュー画像の読み込みを待つ
  await page.waitForTimeout(500);
}

export const test = base.extend<{ fixtures: Record<string, string> }>({
  fixtures: async ({ page }, use) => {
    await page.goto('./');
    await use(await makeFixtures(page));
  },
});

export { expect };
