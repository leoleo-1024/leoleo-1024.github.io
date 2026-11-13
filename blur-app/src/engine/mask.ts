/**
 * 加工範囲（Shape）からマスク（被覆率 0〜255）を生成する。
 * 形状は元画像座標で保持し、任意の縮小レベル・任意の矩形について必要なときにラスタライズする。
 */
import { featherFor, isBinaryMask } from './params';
import { clampToSize, fromBounds, inflate } from './rect';
import type { IRect, Op, Shape } from './types';

/** 形状の外接矩形（元画像の連続座標） */
export function shapeBounds(shape: Shape): { x0: number; y0: number; x1: number; y1: number } {
  switch (shape.type) {
    case 'brush': {
      const p = shape.points;
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (let i = 0; i < p.length; i += 2) {
        if (p[i] < x0) x0 = p[i];
        if (p[i] > x1) x1 = p[i];
        if (p[i + 1] < y0) y0 = p[i + 1];
        if (p[i + 1] > y1) y1 = p[i + 1];
      }
      const r = shape.radius;
      return { x0: x0 - r, y0: y0 - r, x1: x1 + r, y1: y1 + r };
    }
    case 'rect':
      return { x0: shape.x, y0: shape.y, x1: shape.x + shape.w, y1: shape.y + shape.h };
    case 'ellipse':
      return { x0: shape.cx - shape.rx, y0: shape.cy - shape.ry, x1: shape.cx + shape.rx, y1: shape.cy + shape.ry };
  }
}

/** 操作が影響しうる範囲（レベル座標の整数矩形、レベルの範囲内に切り詰め） */
export function opBoundsAtLevel(op: Op, f: number, levelW: number, levelH: number): IRect {
  const b = shapeBounds(op.shape);
  const r = fromBounds(b.x0 / f, b.y0 / f, b.x1 / f, b.y1 / f);
  return clampToSize(inflate(r, 2), levelW, levelH);
}

function coverageFn(op: Op, f: number): (dInside: number) => number {
  const a = f; // アンチエイリアス幅 = 1レベルpx
  if (isBinaryMask(op)) {
    // 黒塗り：画素の一部でも形状にかかっていれば完全に覆う（塗り残し・半透明を出さない）
    const t = -0.5 * f;
    return (d) => (d > t ? 255 : 0);
  }
  const feather = featherFor(op.kind === 'erase' ? 'erase' : op.effect, op.shape);
  if (feather <= a) {
    return (d) => {
      const v = d / a + 0.5;
      return v <= 0 ? 0 : v >= 1 ? 255 : v * 255;
    };
  }
  return (d) => {
    if (d <= 0) return 0;
    if (d >= feather) return 255;
    const t = d / feather;
    return t * t * (3 - 2 * t) * 255;
  };
}

/**
 * レベル座標の矩形 rect について、操作 op のマスクを生成する。
 * f はレベルの縮小率（1レベルpx = 元画像 f px）。
 */
export function rasterizeMask(op: Op, f: number, rect: IRect): Uint8Array {
  const { x: rx, y: ry, w: rw, h: rh } = rect;
  const out = new Uint8Array(rw * rh);
  if (rw <= 0 || rh <= 0) return out;
  const cov = coverageFn(op, f);
  const shape = op.shape;
  if (shape.type === 'rect') {
    const x0 = shape.x;
    const y0 = shape.y;
    const x1 = shape.x + shape.w;
    const y1 = shape.y + shape.h;
    for (let y = 0; y < rh; y++) {
      const py = (ry + y + 0.5) * f;
      const dy = Math.min(py - y0, y1 - py);
      for (let x = 0; x < rw; x++) {
        const px = (rx + x + 0.5) * f;
        const d = Math.min(dy, px - x0, x1 - px);
        out[y * rw + x] = cov(d);
      }
    }
    return out;
  }
  if (shape.type === 'ellipse') {
    const { cx, cy } = shape;
    const ex = Math.max(1e-6, shape.rx);
    const ey = Math.max(1e-6, shape.ry);
    const minR = Math.min(ex, ey);
    for (let y = 0; y < rh; y++) {
      const v = ((ry + y + 0.5) * f - cy) / ey;
      for (let x = 0; x < rw; x++) {
        const u = ((rx + x + 0.5) * f - cx) / ex;
        const rho = Math.sqrt(u * u + v * v);
        let d: number;
        if (rho < 1e-9) d = minR;
        else {
          const g = Math.sqrt((u / ex) * (u / ex) + (v / ey) * (v / ey)) / rho;
          d = (1 - rho) / g;
        }
        out[y * rw + x] = cov(d);
      }
    }
    return out;
  }
  // ブラシ：折れ線（各線分のカプセル形状）の和集合。各画素の折れ線までの最短距離から被覆率を求める
  const pts = shape.points;
  const r = shape.radius;
  const reach = r + 2 * f;
  const dist2 = new Float32Array(rw * rh).fill(Infinity);
  const n = pts.length / 2;
  const rx0 = rx * f;
  const ry0 = ry * f;
  const rx1 = (rx + rw) * f;
  const ry1 = (ry + rh) * f;
  for (let i = 0; i < n; i++) {
    const ax = pts[i * 2];
    const ay = pts[i * 2 + 1];
    const j = i + 1 < n ? i + 1 : i;
    if (j === i && n > 1) continue; // 最後の点は直前の線分に含まれる
    const bx = pts[j * 2];
    const by = pts[j * 2 + 1];
    const sx0 = Math.min(ax, bx) - reach;
    const sy0 = Math.min(ay, by) - reach;
    const sx1 = Math.max(ax, bx) + reach;
    const sy1 = Math.max(ay, by) + reach;
    if (sx1 < rx0 || sx0 > rx1 || sy1 < ry0 || sy0 > ry1) continue;
    const lx0 = Math.max(0, Math.floor(sx0 / f) - rx);
    const ly0 = Math.max(0, Math.floor(sy0 / f) - ry);
    const lx1 = Math.min(rw, Math.ceil(sx1 / f) - rx);
    const ly1 = Math.min(rh, Math.ceil(sy1 / f) - ry);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const inv = len2 > 0 ? 1 / len2 : 0;
    for (let y = ly0; y < ly1; y++) {
      const py = (ry + y + 0.5) * f;
      const row = y * rw;
      for (let x = lx0; x < lx1; x++) {
        const px = (rx + x + 0.5) * f;
        let t = ((px - ax) * dx + (py - ay) * dy) * inv;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = ax + t * dx - px;
        const qy = ay + t * dy - py;
        const d2 = qx * qx + qy * qy;
        if (d2 < dist2[row + x]) dist2[row + x] = d2;
      }
    }
  }
  for (let i = 0; i < out.length; i++) {
    const d2 = dist2[i];
    if (d2 === Infinity) continue;
    out[i] = cov(r - Math.sqrt(d2));
  }
  return out;
}
