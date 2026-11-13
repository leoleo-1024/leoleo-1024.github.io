/**
 * モザイク（ピクセレート）。ブロック格子は元画像の原点 (0,0) に固定し、
 * ブロック内の平均色で塗る。どの範囲・どのタイルから計算しても同じブロックは同じ色になる。
 */
import type { IRect } from '../types';

/** レベル座標 x の画素が属するブロック番号（bl はレベルpx単位のブロック幅） */
export function blockIndex(x: number, bl: number): number {
  return Math.floor((x + 0.5) / bl);
}

/** ブロック i に属する画素の範囲 [start, end) */
export function blockRange(i: number, bl: number): [number, number] {
  return [Math.ceil(i * bl - 0.5), Math.ceil((i + 1) * bl - 0.5)];
}

/** 出力範囲 rect を計算するために読む必要がある範囲（ブロック境界まで広げ、画像内に切り詰め） */
export function pixelateSourceRect(rect: IRect, bl: number, W: number, H: number): IRect {
  const [x0] = blockRange(blockIndex(rect.x, bl), bl);
  const [, x1] = blockRange(blockIndex(rect.x + rect.w - 1, bl), bl);
  const [y0] = blockRange(blockIndex(rect.y, bl), bl);
  const [, y1] = blockRange(blockIndex(rect.y + rect.h - 1, bl), bl);
  const cx0 = Math.max(0, x0);
  const cy0 = Math.max(0, y0);
  const cx1 = Math.min(W, x1);
  const cy1 = Math.min(H, y1);
  return { x: cx0, y: cy0, w: Math.max(0, cx1 - cx0), h: Math.max(0, cy1 - cy0) };
}

/**
 * src: pixelateSourceRect で得た範囲 srcRect の RGBA。
 * 戻り値: rect の RGBA。
 */
export function pixelate(src: Uint8ClampedArray, srcRect: IRect, rect: IRect, bl: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rect.w * rect.h * 4);
  const bxa = blockIndex(rect.x, bl);
  const bxb = blockIndex(rect.x + rect.w - 1, bl);
  const bya = blockIndex(rect.y, bl);
  const byb = blockIndex(rect.y + rect.h - 1, bl);
  const sx0 = srcRect.x;
  const sy0 = srcRect.y;
  const sx1 = srcRect.x + srcRect.w;
  const sy1 = srcRect.y + srcRect.h;
  for (let by = bya; by <= byb; by++) {
    const [ys, ye] = blockRange(by, bl);
    const y0 = Math.max(ys, sy0);
    const y1 = Math.min(ye, sy1);
    for (let bx = bxa; bx <= bxb; bx++) {
      const [xs, xe] = blockRange(bx, bl);
      const x0 = Math.max(xs, sx0);
      const x1 = Math.min(xe, sx1);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        let i = ((y - sy0) * srcRect.w + (x0 - sx0)) * 4;
        for (let x = x0; x < x1; x++, i += 4) {
          const al = src[i + 3];
          r += src[i] * al;
          g += src[i + 1] * al;
          b += src[i + 2] * al;
          a += al;
          n++;
        }
      }
      let cr = 0;
      let cg = 0;
      let cb = 0;
      let ca = 0;
      if (a > 0) {
        cr = r / a;
        cg = g / a;
        cb = b / a;
        ca = a / n;
      }
      // 出力範囲に塗る
      const oy0 = Math.max(ys, rect.y);
      const oy1 = Math.min(ye, rect.y + rect.h);
      const ox0 = Math.max(xs, rect.x);
      const ox1 = Math.min(xe, rect.x + rect.w);
      for (let y = oy0; y < oy1; y++) {
        let o = ((y - rect.y) * rect.w + (ox0 - rect.x)) * 4;
        for (let x = ox0; x < ox1; x++, o += 4) {
          out[o] = cr;
          out[o + 1] = cg;
          out[o + 2] = cb;
          out[o + 3] = ca;
        }
      }
    }
  }
  return out;
}
