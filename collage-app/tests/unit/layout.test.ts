import { describe, expect, it } from 'vitest';
import { applyLayout, autoGridDims, gridRects, initialFreePlacement, makeLayer, mosaicRects } from '../../src/model/layout';
import { createProject, docOf } from '../../src/model/project';
import type { Rect } from '../../src/model/geometry';

const canvas = { width: 1179, height: 2556 };

function overlaps(a: Rect, b: Rect) {
  return a.x < b.x + b.width - 0.01 && b.x < a.x + a.width - 0.01 && a.y < b.y + b.height - 0.01 && b.y < a.y + a.height - 0.01;
}

describe('grid', () => {
  it('縦長キャンバスでは行が多くなる', () => {
    const d = autoGridDims(6, canvas);
    expect(d.rows * d.cols).toBeGreaterThanOrEqual(6);
    expect(d.rows).toBeGreaterThan(d.cols);
  });

  it('外周余白と画像間余白が指定どおり', () => {
    const { rects } = gridRects(4, { auto: false, rows: 2, cols: 2, gap: 20, padding: 50 }, { width: 1000, height: 2000 });
    expect(rects[0].x).toBeCloseTo(50);
    expect(rects[0].y).toBeCloseTo(50);
    expect(rects[1].x - (rects[0].x + rects[0].width)).toBeCloseTo(20);
    expect(rects[3].x + rects[3].width).toBeCloseTo(950);
    expect(rects[3].y + rects[3].height).toBeCloseTo(1950);
  });
});

describe('mosaic', () => {
  for (const n of [1, 2, 5, 9, 20]) {
    it(`${n}枚：重ならずキャンバス内に収まる`, () => {
      const rects = mosaicRects(n, { seed: 7, gap: 10, padding: 30 }, canvas);
      expect(rects).toHaveLength(n);
      for (const r of rects) {
        expect(r.x).toBeGreaterThanOrEqual(30 - 1e-6);
        expect(r.y).toBeGreaterThanOrEqual(30 - 1e-6);
        expect(r.x + r.width).toBeLessThanOrEqual(canvas.width - 30 + 1e-6);
        expect(r.y + r.height).toBeLessThanOrEqual(canvas.height - 30 + 1e-6);
      }
      for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i], rects[j])).toBe(false);
    });
  }

  it('同じ seed なら同じ結果、異なる seed なら異なる結果', () => {
    const a = mosaicRects(6, { seed: 3, gap: 0, padding: 0 }, canvas);
    expect(mosaicRects(6, { seed: 3, gap: 0, padding: 0 }, canvas)).toEqual(a);
    expect(mosaicRects(6, { seed: 4, gap: 0, padding: 0 }, canvas)).not.toEqual(a);
  });
});

describe('applyLayout', () => {
  it('グリッドではセルに合わせて切り抜き、元画像の比率を保つ', () => {
    const p = createProject();
    const layers = [0, 1, 2].map((i) => makeLayer(`l${i}`, 'a', { x: 0, y: 0, width: 400, height: 300 }, i));
    const doc = applyLayout({ ...docOf(p), layoutMode: 'grid', imageLayers: layers }, { a: { width: 4000, height: 3000 } });
    for (const l of doc.imageLayers) {
      const srcAspect = (l.crop.width * 4000) / (l.crop.height * 3000);
      expect(srcAspect).toBeCloseTo(l.width / l.height, 5);
      expect(l.rotation).toBe(0);
    }
  });

  it('セル数より多い画像は非表示、フリーでは変更しない', () => {
    const p = createProject();
    const layers = [0, 1, 2].map((i) => makeLayer(`l${i}`, 'a', { x: 0, y: 0, width: 100, height: 100 }, i));
    const grid = applyLayout({ ...docOf(p), layoutMode: 'grid', grid: { auto: false, rows: 1, cols: 2, gap: 0, padding: 0 }, imageLayers: layers }, { a: { width: 1, height: 1 } });
    expect(grid.imageLayers.map((l) => l.visible)).toEqual([true, true, false]);
    const free = applyLayout({ ...docOf(p), imageLayers: layers }, { a: { width: 1, height: 1 } });
    expect(free.imageLayers).toEqual(layers);
  });

  it('初期配置はキャンバス内に収まり縦横比を保つ', () => {
    const rects = initialFreePlacement(5, canvas, (i) => (i % 2 ? 0.75 : 1.5));
    rects.forEach((r, i) => {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y + r.height).toBeLessThanOrEqual(canvas.height);
      expect(r.width / r.height).toBeCloseTo(i % 2 ? 0.75 : 1.5);
    });
  });
});
