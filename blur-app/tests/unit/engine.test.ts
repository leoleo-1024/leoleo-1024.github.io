import { describe, expect, it } from 'vitest';
import { Renderer } from '../../src/engine/renderer';
import { gather, readLevel, downsample2x } from '../../src/engine/pixels';
import { rasterizeMask } from '../../src/engine/mask';
import { History, newOpId } from '../../src/engine/history';
import type { EraseOp, Op } from '../../src/engine/types';
import { effect, makeLevel, px, pyramid } from './helpers';

const full = (r: Renderer, ops: Op[], li = 0) => r.render(ops, li, { x: 0, y: 0, w: r.levels[li].w, h: r.levels[li].h });

function diffStats(a: Uint8ClampedArray, b: Uint8ClampedArray) {
  let max = 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    sum += d;
    if (d > max) max = d;
  }
  return { max, mean: sum / a.length };
}

describe('pixels', () => {
  it('gather clamps outside to edge pixels', () => {
    const L = makeLevel(5, 4);
    const out = readLevel(L, { x: -2, y: -1, w: 9, h: 6 });
    expect(px(out, 9, 0, 0)).toEqual(px(L.data, 5, 0, 0));
    expect(px(out, 9, 8, 5)).toEqual(px(L.data, 5, 4, 3));
    expect(px(out, 9, 3, 2)).toEqual(px(L.data, 5, 1, 1));
  });
  it('gather from tiles equals direct read', () => {
    const L = makeLevel(37, 29);
    const T = 8;
    const tile = (tx: number, ty: number) => readLevel(L, { x: tx * T, y: ty * T, w: Math.min(T, 37 - tx * T), h: Math.min(T, 29 - ty * T) });
    const rect = { x: -3, y: 5, w: 45, h: 30 };
    const a = gather(37, 29, T, T, 4, tile, rect, new Uint8ClampedArray(rect.w * rect.h * 4));
    expect(Array.from(a)).toEqual(Array.from(readLevel(L, rect)));
  });
  it('downsample2x averages', () => {
    const L = makeLevel(4, 2, (x) => [x < 2 ? 0 : 200, 0, 0, 255]);
    const d = downsample2x(L);
    expect(d.w).toBe(2);
    expect(px(d.data, 2, 0, 0)[0]).toBe(0);
    expect(px(d.data, 2, 1, 0)[0]).toBe(200);
    expect(d.f).toBe(2);
  });
});

describe('mask', () => {
  it('blackout rect mask is binary and covers every touched pixel', () => {
    const op = effect('blackout', { type: 'rect', x: 10.3, y: 10.7, w: 20.2, h: 5.1 });
    const m = rasterizeMask(op, 1, { x: 0, y: 0, w: 40, h: 30 });
    const vals = new Set(m);
    expect([...vals].sort()).toEqual([0, 255]);
    // 部分的にかかる画素（x=10, y=10）も完全に覆う
    expect(m[10 * 40 + 10]).toBe(255);
    expect(m[10 * 40 + 30]).toBe(255);
    expect(m[15 * 40 + 20]).toBe(255);
    expect(m[16 * 40 + 20]).toBe(0);
    expect(m[18 * 40 + 20]).toBe(0);
    expect(m[12 * 40 + 8]).toBe(0);
  });
  it('brush covers the whole segment even for long fast strokes', () => {
    const op = effect('pixelate', { type: 'brush', points: [5, 5, 95, 5], radius: 3 });
    const m = rasterizeMask(op, 1, { x: 0, y: 0, w: 100, h: 10 });
    for (let x = 5; x < 95; x++) expect(m[5 * 100 + x]).toBe(255);
    expect(m[9 * 100 + 50]).toBe(0);
  });
});

describe('renderer', () => {
  const W = 120;
  const H = 90;

  it('no ops → identical to source', () => {
    const r = new Renderer(pyramid(W, H));
    expect(Array.from(full(r, []))).toEqual(Array.from(r.levels[0].data));
  });

  it.each(['gaussianBlur', 'pixelate', 'swirl', 'motionBlur', 'blackout'] as const)('%s: changes only inside the selection', (eff) => {
    const r = new Renderer(pyramid(W, H));
    const op = effect(eff, { type: 'rect', x: 30, y: 20, w: 50, h: 40 }, { strength: 8, angle: 30 });
    const out = full(r, [op]);
    const src = r.levels[0].data;
    let changedInside = 0;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const inside = x >= 30 && x < 80 && y >= 20 && y < 60;
        const same = px(out, W, x, y).join() === px(src, W, x, y).join();
        if (!inside) expect(same, `${eff} outside ${x},${y}`).toBe(true);
        else if (!same) changedInside++;
      }
    expect(changedInside).toBeGreaterThan(1000);
  });

  it('blackout is pure opaque black', () => {
    const r = new Renderer(pyramid(W, H));
    const out = full(r, [effect('blackout', { type: 'ellipse', cx: 60, cy: 45, rx: 20, ry: 10 })]);
    expect(px(out, W, 60, 45)).toEqual([0, 0, 0, 255]);
    expect(px(out, W, 41, 45)).toEqual([0, 0, 0, 255]);
  });

  it('tiled / partial rendering matches full rendering', () => {
    const levels = pyramid(700, 530);
    const ops: Op[] = [
      effect('gaussianBlur', { type: 'rect', x: 10, y: 10, w: 400, h: 300 }, { strength: 9 }),
      effect('pixelate', { type: 'brush', points: [50, 50, 600, 400, 300, 500], radius: 40 }, { strength: 6 }),
      effect('motionBlur', { type: 'ellipse', cx: 400, cy: 300, rx: 200, ry: 150 }, { strength: 7, angle: 45 }),
      effect('swirl', { type: 'brush', points: [100, 400, 500, 120], radius: 60 }, { strength: 6 }),
      effect('blackout', { type: 'rect', x: 250, y: 200, w: 100, h: 60 }),
      effect('gaussianBlur', { type: 'rect', x: 200, y: 150, w: 220, h: 160 }, { strength: 3 }),
    ];
    const r1 = new Renderer(levels);
    const whole = full(r1, ops);
    const r2 = new Renderer(levels);
    const parts = new Uint8ClampedArray(whole.length);
    for (let y = 0; y < 530; y += 77)
      for (let x = 0; x < 700; x += 101) {
        const rect = { x, y, w: Math.min(101, 700 - x), h: Math.min(77, 530 - y) };
        const p = r2.render(ops, 0, rect);
        for (let yy = 0; yy < rect.h; yy++) parts.set(p.subarray(yy * rect.w * 4, (yy + 1) * rect.w * 4), ((y + yy) * 700 + x) * 4);
      }
    expect(diffStats(whole, parts).max).toBe(0);
  });

  it('eraser restores the original and effects can be re-applied after erasing', () => {
    const r = new Renderer(pyramid(W, H));
    const a = effect('pixelate', { type: 'rect', x: 0, y: 0, w: W, h: H }, { strength: 10 });
    const b = effect('blackout', { type: 'rect', x: 20, y: 20, w: 40, h: 40 });
    const er: EraseOp = { id: newOpId(), kind: 'erase', shape: { type: 'brush', points: [10, 45, 110, 45], radius: 12 } };
    const out = full(r, [a, b, er]);
    expect(px(out, W, 50, 45)).toEqual(px(r.levels[0].data, W, 50, 45));
    expect(px(out, W, 100, 45)).toEqual(px(r.levels[0].data, W, 100, 45));
    expect(px(out, W, 30, 25)).toEqual([0, 0, 0, 255]);
    const again = effect('blackout', { type: 'rect', x: 45, y: 40, w: 10, h: 10 });
    expect(px(full(r, [a, b, er, again]), W, 50, 45)).toEqual([0, 0, 0, 255]);
  });

  it('effects over a blackout do not reveal hidden pixels', () => {
    // 中央に強い模様、黒塗りしてから全体をぼかす → 黒塗り内部は黒のまま
    const levels = pyramid(200, 200, (x, y) => (Math.abs(x - 100) < 30 && Math.abs(y - 100) < 30 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
    const r = new Renderer(levels);
    const black = effect('blackout', { type: 'rect', x: 60, y: 60, w: 80, h: 80 });
    for (const eff of ['gaussianBlur', 'pixelate', 'motionBlur', 'swirl'] as const) {
      const over = effect(eff, { type: 'rect', x: 0, y: 0, w: 200, h: 200 }, { strength: 10 });
      const out = full(r, [black, over]);
      let maxv = 0;
      for (let i = 0; i < out.length; i += 4) maxv = Math.max(maxv, out[i], out[i + 1], out[i + 2]);
      expect(maxv, eff).toBe(0);
    }
  });

  it('undo/redo reproduces the same image', () => {
    const r = new Renderer(pyramid(W, H));
    const h = new History();
    h.push(effect('gaussianBlur', { type: 'rect', x: 5, y: 5, w: 60, h: 60 }));
    h.push(effect('swirl', { type: 'ellipse', cx: 60, cy: 45, rx: 30, ry: 30 }));
    const before = full(r, [...h.ops]);
    h.undo();
    expect(Array.from(full(r, [...h.ops]))).not.toEqual(Array.from(before));
    h.redo();
    expect(Array.from(full(r, [...h.ops]))).toEqual(Array.from(before));
    expect(h.dirty).toBe(true);
    h.markSaved();
    expect(h.dirty).toBe(false);
  });

  it('mosaic grid is anchored to the image: two adjacent regions = one big region', () => {
    const r = new Renderer(pyramid(W, H));
    const one = full(r, [effect('pixelate', { type: 'rect', x: 0, y: 0, w: W, h: H }, { strength: 3 })]);
    const two = full(r, [
      effect('pixelate', { type: 'rect', x: 0, y: 0, w: 47, h: H }, { strength: 3 }),
      effect('pixelate', { type: 'rect', x: 47, y: 0, w: W - 47, h: H }, { strength: 3 }),
    ]);
    expect(diffStats(one, two).max).toBe(0);
  });

  it('mosaic block size grows with strength', () => {
    const r = new Renderer(pyramid(400, 300));
    const distinctInRow = (s: number) => {
      const out = full(r, [effect('pixelate', { type: 'rect', x: 0, y: 0, w: 400, h: 300 }, { strength: s })]);
      const set = new Set<string>();
      for (let x = 0; x < 400; x++) set.add(px(out, 400, x, 150).join());
      return set.size;
    };
    expect(distinctInRow(1)).toBeGreaterThan(distinctInRow(5));
    expect(distinctInRow(5)).toBeGreaterThan(distinctInRow(10));
  });

  it('swirl direction and strength change the result; center stays fixed', () => {
    const r = new Renderer(pyramid(200, 200));
    const shape = { type: 'ellipse' as const, cx: 100, cy: 100, rx: 80, ry: 80 };
    const cw = full(r, [effect('swirl', shape, { swirlDirection: 'cw' })]);
    const ccw = full(r, [effect('swirl', shape, { swirlDirection: 'ccw' })]);
    const weak = full(r, [effect('swirl', shape, { strength: 1 })]);
    expect(diffStats(cw, ccw).mean).toBeGreaterThan(5);
    expect(diffStats(cw, weak).mean).toBeGreaterThan(5);
    const src = r.levels[0].data;
    expect(diffStats(weak, src).mean).toBeLessThan(diffStats(cw, src).mean);
  });

  it('motion blur follows the angle (0° = horizontal)', () => {
    // 縦縞：水平ブラーで均され、垂直ブラーではほぼ変わらない
    const levels = pyramid(200, 200, (x) => (x % 8 < 4 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
    const r = new Renderer(levels);
    const rect = { type: 'rect' as const, x: 0, y: 0, w: 200, h: 200 };
    const hz = full(r, [effect('motionBlur', rect, { angle: 0 })]);
    const vt = full(r, [effect('motionBlur', rect, { angle: 90 })]);
    const src = r.levels[0].data;
    expect(diffStats(hz, src).mean).toBeGreaterThan(60);
    expect(diffStats(vt, src).mean).toBeLessThan(2);
    // 180° 違いは同じ結果
    const a30 = full(r, [effect('motionBlur', rect, { angle: 30 })]);
    const a210 = full(r, [effect('motionBlur', rect, { angle: 210 })]);
    expect(diffStats(a30, a210).max).toBe(0);
  });

  it('motion blur length grows with strength; no dark edges at the image border', () => {
    const levels = pyramid(300, 100, (x) => (x === 150 ? [255, 255, 255, 255] : [100, 100, 100, 255]));
    const r = new Renderer(levels);
    const rect = { type: 'rect' as const, x: 0, y: 0, w: 300, h: 100 };
    const width = (s: number) => {
      const out = full(r, [effect('motionBlur', rect, { strength: s })]);
      let n = 0;
      for (let x = 0; x < 300; x++) if (px(out, 300, x, 50)[0] > 101) n++;
      for (let x = 0; x < 300; x++) expect(px(out, 300, x, 50)[0]).toBeGreaterThanOrEqual(99);
      return n;
    };
    expect(width(8)).toBeGreaterThan(width(2));
  });

  it('gaussian blur keeps flat areas flat at image borders (no black/transparent edges)', () => {
    const r = new Renderer(pyramid(150, 100, () => [200, 120, 40, 255]));
    const out = full(r, [effect('gaussianBlur', { type: 'rect', x: 0, y: 0, w: 150, h: 100 }, { strength: 10 })]);
    for (let i = 0; i < out.length; i += 4) {
      expect(Math.abs(out[i] - 200)).toBeLessThanOrEqual(1);
      expect(out[i + 3]).toBe(255);
    }
  });

  it('preview level is consistent with full resolution', () => {
    const levels = pyramid(640, 480, (x, y) => [((x >> 4) * 37 + (y >> 4) * 11) % 256, (x * 3) % 256, (y * 5) % 256, 255]);
    const ops: Op[] = [
      effect('gaussianBlur', { type: 'rect', x: 20, y: 20, w: 300, h: 200 }, { strength: 6 }),
      effect('pixelate', { type: 'rect', x: 330, y: 20, w: 290, h: 200 }, { strength: 5 }),
      effect('swirl', { type: 'ellipse', cx: 160, cy: 350, rx: 120, ry: 100 }, { strength: 5 }),
      effect('motionBlur', { type: 'rect', x: 330, y: 250, w: 290, h: 200 }, { strength: 5, angle: 60 }),
    ];
    const r = new Renderer(levels);
    const hi = full(r, ops, 0);
    const lo = full(r, ops, 1);
    const hiDown = downsample2x({ w: 640, h: 480, f: 1, data: hi }).data;
    expect(diffStats(hiDown, lo).mean).toBeLessThan(4);
  });
});
