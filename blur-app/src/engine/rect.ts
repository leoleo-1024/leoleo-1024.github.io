import type { IRect } from './types';

export const EMPTY: IRect = { x: 0, y: 0, w: 0, h: 0 };

export function isEmpty(r: IRect): boolean {
  return r.w <= 0 || r.h <= 0;
}

export function intersect(a: IRect, b: IRect): IRect {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  if (x1 <= x0 || y1 <= y0) return { x: x0, y: y0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function union(a: IRect, b: IRect): IRect {
  if (isEmpty(a)) return b;
  if (isEmpty(b)) return a;
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.w, b.x + b.w);
  const y1 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function inflate(r: IRect, d: number): IRect {
  return { x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d };
}

/** 浮動小数の範囲 [x0,x1)×[y0,y1) を覆う整数矩形 */
export function fromBounds(x0: number, y0: number, x1: number, y1: number): IRect {
  const ix0 = Math.floor(x0);
  const iy0 = Math.floor(y0);
  const ix1 = Math.ceil(x1);
  const iy1 = Math.ceil(y1);
  return { x: ix0, y: iy0, w: Math.max(0, ix1 - ix0), h: Math.max(0, iy1 - iy0) };
}

export function clampToSize(r: IRect, w: number, h: number): IRect {
  return intersect(r, { x: 0, y: 0, w, h });
}
