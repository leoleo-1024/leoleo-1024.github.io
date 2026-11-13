/**
 * モーションブラー（指定角度の直線に沿った一様なぼかし、軸の両方向へ対称）。
 * 長い距離でもサンプル数が増えすぎないよう、「間隔の広い T 点の平均」を間隔を 1/T にしながら
 * 繰り返す（T 点の櫛形フィルターの畳み込み = 全長 L の一様フィルター）。
 * パス数は log_T(L) 程度で、1画素あたりのサンプル数は T × パス数。
 */

const TAPS = 8;

/** 参照範囲（中心から各軸方向に必要な余白） */
export function motionMargin(length: number, angleDeg: number): { mx: number; my: number } {
  const a = (angleDeg * Math.PI) / 180;
  const reach = length * 0.6 + 2;
  return { mx: Math.ceil(Math.abs(Math.cos(a)) * reach) + 1, my: Math.ceil(Math.abs(Math.sin(a)) * reach) + 1 };
}

/** パスごとの (タップ数, 間隔) */
export function motionPasses(length: number): Array<{ taps: number; spacing: number }> {
  const passes: Array<{ taps: number; spacing: number }> = [];
  if (length <= 1) return passes;
  let span = length; // このパスで覆う全長
  for (let guard = 0; guard < 8; guard++) {
    const taps = Math.min(TAPS, Math.max(2, Math.ceil(span)));
    const spacing = span / taps;
    passes.push({ taps, spacing });
    if (spacing <= 1) break;
    span = spacing;
  }
  return passes;
}

/** buf（乗算済み Float32 RGBA, w×h）に方向ブラーをかける。端は clamp-to-edge */
export function motionBlur(buf: Float32Array, w: number, h: number, length: number, angleDeg: number): Float32Array {
  const passes = motionPasses(length);
  if (!passes.length) return buf;
  const a = (angleDeg * Math.PI) / 180;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  let src: Float32Array = buf;
  let dst: Float32Array = new Float32Array(buf.length);
  const maxX = w - 1;
  const maxY = h - 1;
  for (const { taps, spacing } of passes) {
    const offs: Array<[number, number]> = [];
    for (let k = 0; k < taps; k++) {
      const t = (k - (taps - 1) / 2) * spacing;
      offs.push([t * ux, t * uy]);
    }
    const inv = 1 / taps;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let al = 0;
        for (let k = 0; k < taps; k++) {
          let sx = x + offs[k][0];
          let sy = y + offs[k][1];
          sx = sx < 0 ? 0 : sx > maxX ? maxX : sx;
          sy = sy < 0 ? 0 : sy > maxY ? maxY : sy;
          const x0 = sx | 0;
          const y0 = sy | 0;
          const x1 = x0 < maxX ? x0 + 1 : x0;
          const y1 = y0 < maxY ? y0 + 1 : y0;
          const fx = sx - x0;
          const fy = sy - y0;
          const w00 = (1 - fx) * (1 - fy);
          const w10 = fx * (1 - fy);
          const w01 = (1 - fx) * fy;
          const w11 = fx * fy;
          const i00 = (y0 * w + x0) * 4;
          const i10 = (y0 * w + x1) * 4;
          const i01 = (y1 * w + x0) * 4;
          const i11 = (y1 * w + x1) * 4;
          r += src[i00] * w00 + src[i10] * w10 + src[i01] * w01 + src[i11] * w11;
          g += src[i00 + 1] * w00 + src[i10 + 1] * w10 + src[i01 + 1] * w01 + src[i11 + 1] * w11;
          b += src[i00 + 2] * w00 + src[i10 + 2] * w10 + src[i01 + 2] * w01 + src[i11 + 2] * w11;
          al += src[i00 + 3] * w00 + src[i10 + 3] * w10 + src[i01 + 3] * w01 + src[i11 + 3] * w11;
        }
        const o = (y * w + x) * 4;
        dst[o] = r * inv;
        dst[o + 1] = g * inv;
        dst[o + 2] = b * inv;
        dst[o + 3] = al * inv;
      }
    }
    const t = src === buf ? new Float32Array(buf.length) : src;
    src = dst;
    dst = t;
  }
  return src;
}
