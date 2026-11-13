/**
 * ガウスぼかし（3回のボックスブラーで近似、各パスは半径に依存しない O(n)）。
 * 入力は乗算済みアルファの Float32 RGBA。端は入力領域の端の画素を複製して扱う。
 */

/** 標準偏差 sigma のガウス分布を n 回のボックスブラーで近似するときの各ボックスの半径 */
export function boxRadiiForGauss(sigma: number, n = 3): number[] {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  const radii: number[] = [];
  for (let i = 0; i < n; i++) radii.push(((i < m ? wl : wu) - 1) / 2);
  return radii;
}

/** ガウスぼかしの影響範囲（この幅だけ周囲の画素を参照する） */
export function gaussianMargin(sigma: number): number {
  return boxRadiiForGauss(sigma).reduce((a, b) => a + b, 0) + 2;
}

function boxH(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const iarr = 1 / (r + r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let c = 0; c < 4; c++) {
      const first = src[row + c];
      const last = src[row + (w - 1) * 4 + c];
      let acc = first * (r + 1);
      for (let j = 0; j < r; j++) acc += src[row + Math.min(j, w - 1) * 4 + c];
      for (let x = 0; x < w; x++) {
        const addX = x + r;
        const subX = x - r - 1;
        acc += addX < w ? src[row + addX * 4 + c] : last;
        acc -= subX >= 0 ? src[row + subX * 4 + c] : first;
        dst[row + x * 4 + c] = acc * iarr;
      }
    }
  }
}

function boxV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const iarr = 1 / (r + r + 1);
  const stride = w * 4;
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 4; c++) {
      const col = x * 4 + c;
      const first = src[col];
      const last = src[(h - 1) * stride + col];
      let acc = first * (r + 1);
      for (let j = 0; j < r; j++) acc += src[Math.min(j, h - 1) * stride + col];
      for (let y = 0; y < h; y++) {
        const addY = y + r;
        const subY = y - r - 1;
        acc += addY < h ? src[addY * stride + col] : last;
        acc -= subY >= 0 ? src[subY * stride + col] : first;
        dst[y * stride + col] = acc * iarr;
      }
    }
  }
}

/** buf（乗算済み Float32 RGBA, w×h）をその場でぼかす */
export function gaussianBlurInPlace(buf: Float32Array, w: number, h: number, sigma: number): void {
  if (sigma < 0.3 || w === 0 || h === 0) return;
  const tmp = new Float32Array(buf.length);
  for (const r of boxRadiiForGauss(sigma)) {
    if (r <= 0) continue;
    boxH(buf, tmp, w, h, r);
    boxV(tmp, buf, w, h, r);
  }
}
