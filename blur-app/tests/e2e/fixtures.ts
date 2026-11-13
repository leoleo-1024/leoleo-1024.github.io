import type { CDPSession, Page } from '@playwright/test';
import { JpegEncoder } from '../../src/codec/jpeg';
import { PngEncoder } from '../../src/codec/png';

export type Pattern = (x: number, y: number) => [number, number, number, number];

/** 決定的な模様（場所ごとに色が違い、ぼかし等の変化が分かりやすい） */
export const checker: Pattern = (x, y) => {
  const c = ((x >> 3) + (y >> 3)) % 2 ? 230 : 25;
  return [c, (x * 255) / 600, (y * 255) / 400, 255];
};

function rgba(w: number, h: number, fn: Pattern) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = fn(x, y);
      d.set(v, (y * w + x) * 4);
    }
  return d;
}

export async function makePng(w: number, h: number, fn: Pattern = checker, alpha = false): Promise<Buffer> {
  const enc = new PngEncoder(w, h, alpha);
  const step = 64;
  for (let y = 0; y < h; y += step) {
    const rows = Math.min(step, h - y);
    await enc.addRows(rgba(w, rows, (x, yy) => fn(x, y + yy)), rows);
  }
  return Buffer.concat(await enc.finish());
}

/** EXIF の Orientation を付けた JPEG */
export function makeJpeg(w: number, h: number, fn: Pattern = checker, orientation?: number): Buffer {
  const enc = new JpegEncoder(w, h, 95);
  enc.addRows(rgba(w, h, fn), h);
  const jpg = Buffer.concat(enc.finish());
  if (!orientation) return jpg;
  // APP1 Exif（ビッグエンディアン、IFD0 に Orientation 1件）
  const tiff = Buffer.from([
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]), payload]);
  return Buffer.concat([jpg.subarray(0, 2), app1, jpg.subarray(2)]);
}

export async function openImage(page: Page, buf: Buffer, name: string, mimeType: string) {
  await page.getByTestId('file-input').setInputFiles({ name, mimeType, buffer: buf });
  await page.waitForFunction(() => {
    const a = (window as any).__app;
    return a.getEditor() && !a.store.get().busy;
  });
  await waitIdle(page);
}

export async function waitIdle(page: Page) {
  await page.waitForFunction(() => {
    const e = (window as any).__app.getEditor();
    return !e || e.idle;
  });
}

/** 元画像座標 → ページ座標 */
export async function toClient(page: Page, ix: number, iy: number): Promise<[number, number]> {
  return page.evaluate(([x, y]) => (window as any).__app.getEditor().imageToClient(x, y), [ix, iy] as [number, number]);
}

/** CDP で本物のタッチイベントを送る（ピンチ・ドラッグ用） */
export class Touch {
  private cdp!: CDPSession;
  constructor(private page: Page) {}
  async init() {
    this.cdp = await this.page.context().newCDPSession(this.page);
    return this;
  }
  private async send(type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', points: Array<[number, number]>) {
    await this.cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map(([x, y], id) => ({ x, y, id, radiusX: 1, radiusY: 1, force: 1 })),
    });
  }
  /** 1本指でなぞる */
  async drag(path: Array<[number, number]>, steps = 6) {
    await this.send('touchStart', [path[0]]);
    for (let i = 1; i < path.length; i++) {
      const [ax, ay] = path[i - 1];
      const [bx, by] = path[i];
      for (let s = 1; s <= steps; s++) await this.send('touchMove', [[ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps]]);
    }
    await this.send('touchEnd', []);
  }
  async start(points: Array<[number, number]>) {
    await this.send('touchStart', points);
  }
  async move(points: Array<[number, number]>) {
    await this.send('touchMove', points);
  }
  async end() {
    await this.send('touchEnd', []);
  }
  /** 2本指のピンチ（中心 c、開始時の指の間隔 d0 → d1） */
  async pinch(c: [number, number], d0: number, d1: number, steps = 8) {
    const pts = (d: number): Array<[number, number]> => [
      [c[0] - d / 2, c[1]],
      [c[0] + d / 2, c[1]],
    ];
    await this.send('touchStart', pts(d0));
    for (let s = 1; s <= steps; s++) await this.send('touchMove', pts(d0 + ((d1 - d0) * s) / steps));
    await this.send('touchEnd', []);
  }
}

/** ページ内で書き出し結果（Blob）をデコードして画素を返す */
export async function decodeBlobUrl(page: Page, url: string) {
  return page.evaluate(async (u) => {
    const b = await (await fetch(u)).blob();
    const bmp = await createImageBitmap(b);
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    return { w: bmp.width, h: bmp.height, type: b.type, size: b.size, data: Array.from(d) };
  }, url);
}
