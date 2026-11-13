/** RGBA バッファの基本操作（すべて非負整数座標・行優先・4ch） */
import type { IRect, Level } from './types';

/** 半分のサイズに縮小（2×2 の平均。透明部分の色がにじまないようアルファで重み付け） */
export function downsample2x(src: Level): Level {
  const w = Math.max(1, Math.ceil(src.w / 2));
  const h = Math.max(1, Math.ceil(src.h / 2));
  const out = new Uint8ClampedArray(w * h * 4);
  const sd = src.data;
  const sw = src.w;
  const sh = src.h;
  for (let y = 0; y < h; y++) {
    const y0 = y * 2;
    const y1 = Math.min(y0 + 1, sh - 1);
    for (let x = 0; x < w; x++) {
      const x0 = x * 2;
      const x1 = Math.min(x0 + 1, sw - 1);
      const i00 = (y0 * sw + x0) * 4;
      const i01 = (y0 * sw + x1) * 4;
      const i10 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;
      const a00 = sd[i00 + 3];
      const a01 = sd[i01 + 3];
      const a10 = sd[i10 + 3];
      const a11 = sd[i11 + 3];
      const as = a00 + a01 + a10 + a11;
      const o = (y * w + x) * 4;
      if (as === 1020) {
        out[o] = (sd[i00] + sd[i01] + sd[i10] + sd[i11] + 2) >> 2;
        out[o + 1] = (sd[i00 + 1] + sd[i01 + 1] + sd[i10 + 1] + sd[i11 + 1] + 2) >> 2;
        out[o + 2] = (sd[i00 + 2] + sd[i01 + 2] + sd[i10 + 2] + sd[i11 + 2] + 2) >> 2;
        out[o + 3] = 255;
      } else if (as > 0) {
        out[o] = (sd[i00] * a00 + sd[i01] * a01 + sd[i10] * a10 + sd[i11] * a11) / as;
        out[o + 1] = (sd[i00 + 1] * a00 + sd[i01 + 1] * a01 + sd[i10 + 1] * a10 + sd[i11 + 1] * a11) / as;
        out[o + 2] = (sd[i00 + 2] * a00 + sd[i01 + 2] * a01 + sd[i10 + 2] * a10 + sd[i11 + 2] * a11) / as;
        out[o + 3] = (as + 2) >> 2;
      }
    }
  }
  return { w, h, f: src.f * 2, data: out };
}

/** 縮小ピラミッドを作る（levels[0] が元画像。長辺 minSide 以下になるまで 1/2 ずつ） */
export function buildPyramid(l0: Level, minSide = 48): Level[] {
  const levels = [l0];
  let cur = l0;
  while (Math.max(cur.w, cur.h) > minSide && Math.min(cur.w, cur.h) > 1) {
    cur = downsample2x(cur);
    levels.push(cur);
  }
  return levels;
}

/**
 * タイル分割された画像から矩形を切り出す。範囲外は端の画素を複製する（clamp-to-edge）。
 * tileW/tileH はタイルの大きさ、getTile はタイル（幅 min(tileW, W - tx*tileW)）を返す。
 * channels は 1（マスク）または 4（RGBA）。
 */
export function gather<T extends Uint8ClampedArray | Uint8Array>(
  W: number,
  H: number,
  tileW: number,
  tileH: number,
  channels: number,
  getTile: (tx: number, ty: number) => T,
  rect: IRect,
  out: T,
): T {
  const { x: rx, y: ry, w: rw, h: rh } = rect;
  const ntx = Math.ceil(W / tileW);
  const local = new Map<number, T>();
  const tileOf = (tx: number, ty: number): T => {
    const k = ty * ntx + tx;
    let t = local.get(k);
    if (!t) {
      t = getTile(tx, ty);
      local.set(k, t);
    }
    return t;
  };
  const inX0 = Math.max(0, rx);
  const inX1 = Math.min(W, rx + rw);
  for (let oy = 0; oy < rh; oy++) {
    const sy = Math.min(H - 1, Math.max(0, ry + oy));
    const ty = Math.floor(sy / tileH);
    const ly = sy - ty * tileH;
    const rowOut = oy * rw * channels;
    if (inX1 > inX0) {
      let x = inX0;
      while (x < inX1) {
        const tx = Math.floor(x / tileW);
        const tx0 = tx * tileW;
        const tw = Math.min(tileW, W - tx0);
        const end = Math.min(inX1, tx0 + tw);
        const t = tileOf(tx, ty);
        const s0 = (ly * tw + (x - tx0)) * channels;
        out.set(t.subarray(s0, s0 + (end - x) * channels), rowOut + (x - rx) * channels);
        x = end;
      }
    }
    // 左右の範囲外：端の画素を複製
    if (rx < 0 || rx + rw > W) {
      const leftN = Math.min(rw, Math.max(0, -rx));
      const rightStart = Math.max(0, Math.min(rw, W - rx));
      const edgeL = rowOut + (Math.max(0, inX0 - rx)) * channels;
      const edgeR = rowOut + (Math.max(0, inX1 - 1 - rx)) * channels;
      if (inX1 <= inX0) {
        // 矩形が完全に左右どちらかの外側
        const sx = rx + rw <= 0 ? 0 : W - 1;
        const tx = Math.floor(sx / tileW);
        const tw = Math.min(tileW, W - tx * tileW);
        const t = tileOf(tx, ty);
        const s0 = (ly * tw + (sx - tx * tileW)) * channels;
        for (let i = 0; i < rw; i++) for (let c = 0; c < channels; c++) out[rowOut + i * channels + c] = t[s0 + c];
        continue;
      }
      for (let i = 0; i < leftN; i++) for (let c = 0; c < channels; c++) out[rowOut + i * channels + c] = out[edgeL + c];
      for (let i = rightStart; i < rw; i++) for (let c = 0; c < channels; c++) out[rowOut + i * channels + c] = out[edgeR + c];
    }
  }
  return out;
}

/** Level から矩形を切り出す（範囲外は clamp-to-edge） */
export function readLevel(level: Level, rect: IRect): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rect.w * rect.h * 4);
  return gather(level.w, level.h, level.w, level.h, 4, () => level.data, rect, out);
}

/** dst = dst + (src - dst) * m/255（src が null のときは黒 RGB(0,0,0) 不透明） */
export function blendMasked(
  dst: Uint8ClampedArray,
  src: Uint8ClampedArray | null,
  mask: Uint8Array,
  dstW: number,
  sub: IRect,
  dstOrigin: { x: number; y: number },
): void {
  const { w, h } = sub;
  for (let y = 0; y < h; y++) {
    let di = ((sub.y - dstOrigin.y + y) * dstW + (sub.x - dstOrigin.x)) * 4;
    let mi = y * w;
    let si = y * w * 4;
    for (let x = 0; x < w; x++, di += 4, si += 4, mi++) {
      const m = mask[mi];
      if (m === 0) continue;
      if (m === 255) {
        if (src) {
          dst[di] = src[si];
          dst[di + 1] = src[si + 1];
          dst[di + 2] = src[si + 2];
          dst[di + 3] = src[si + 3];
        } else {
          dst[di] = 0;
          dst[di + 1] = 0;
          dst[di + 2] = 0;
          dst[di + 3] = 255;
        }
        continue;
      }
      const im = 255 - m;
      if (src) {
        dst[di] = (dst[di] * im + src[si] * m) / 255;
        dst[di + 1] = (dst[di + 1] * im + src[si + 1] * m) / 255;
        dst[di + 2] = (dst[di + 2] * im + src[si + 2] * m) / 255;
        dst[di + 3] = (dst[di + 3] * im + src[si + 3] * m) / 255;
      } else {
        dst[di] = (dst[di] * im) / 255;
        dst[di + 1] = (dst[di + 1] * im) / 255;
        dst[di + 2] = (dst[di + 2] * im) / 255;
        dst[di + 3] = (dst[di + 3] * im + 255 * m) / 255;
      }
    }
  }
}

/** RGBA(Uint8) → 乗算済みアルファの Float32 */
export function toPremultFloat(src: Uint8ClampedArray): Float32Array {
  const n = src.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 4) {
    const a = src[i + 3];
    if (a === 255) {
      out[i] = src[i];
      out[i + 1] = src[i + 1];
      out[i + 2] = src[i + 2];
      out[i + 3] = 255;
    } else {
      const k = a / 255;
      out[i] = src[i] * k;
      out[i + 1] = src[i + 1] * k;
      out[i + 2] = src[i + 2] * k;
      out[i + 3] = a;
    }
  }
  return out;
}

/** 乗算済み Float32 の部分矩形 → RGBA(Uint8) */
export function fromPremultFloat(
  src: Float32Array,
  srcW: number,
  sub: IRect,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(sub.w * sub.h * 4);
  for (let y = 0; y < sub.h; y++) {
    let si = ((sub.y + y) * srcW + sub.x) * 4;
    let o = y * sub.w * 4;
    for (let x = 0; x < sub.w; x++, si += 4, o += 4) {
      const a = src[si + 3];
      if (a >= 254.5) {
        out[o] = src[si];
        out[o + 1] = src[si + 1];
        out[o + 2] = src[si + 2];
        out[o + 3] = 255;
      } else if (a > 0.001) {
        const k = 255 / a;
        out[o] = src[si] * k;
        out[o + 1] = src[si + 1] * k;
        out[o + 2] = src[si + 2] * k;
        out[o + 3] = a;
      }
    }
  }
  return out;
}
