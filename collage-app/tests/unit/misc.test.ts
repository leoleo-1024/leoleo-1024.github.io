import { describe, expect, it } from 'vitest';
import { emptyHistory, pushHistory, redoHistory, undoHistory } from '../../src/state/history';
import { parseRoute, routeToHash } from '../../src/lib/router';
import { validateCanvasSize } from '../../src/model/presets';
import { gradientPoints } from '../../src/render/renderProject';
import { exportFileName } from '../../src/render/export';

describe('history', () => {
  it('undo/redo と上限', () => {
    let h = emptyHistory<number>();
    for (let i = 0; i < 60; i++) h = pushHistory(h, i, 50);
    expect(h.past).toHaveLength(50);
    expect(h.past[0]).toBe(10);
    const u = undoHistory(h, 60)!;
    expect(u.value).toBe(59);
    const r = redoHistory(u.history, u.value)!;
    expect(r.value).toBe(60);
    expect(pushHistory(u.history, 1).future).toHaveLength(0);
  });
});

describe('router', () => {
  it('往復変換', () => {
    for (const r of [
      { name: 'home' },
      { name: 'settings' },
      { name: 'editor', projectId: 'a-b' },
      { name: 'images', projectId: 'x' },
      { name: 'preview', projectId: 'x' },
      { name: 'export', projectId: 'x' },
    ] as const) {
      expect(parseRoute(routeToHash(r))).toEqual(r);
    }
    expect(parseRoute('')).toEqual({ name: 'home' });
  });
});

describe('presets', () => {
  it('サイズ検証', () => {
    expect(validateCanvasSize(1179, 2556)).toBeNull();
    expect(validateCanvasSize(50, 2556)).not.toBeNull();
    expect(validateCanvasSize(8000, 8000)).not.toBeNull();
  });
});

describe('render helpers', () => {
  it('グラデーション 180° は上から下', () => {
    const p = gradientPoints(100, 200, 180);
    expect(p.x0).toBeCloseTo(50);
    expect(p.y0).toBeCloseTo(0);
    expect(p.y1).toBeCloseTo(200);
  });
  it('ファイル名に使えない文字を除去', () => {
    expect(exportFileName('a/b:c', 'png')).toMatch(/^a_b_c-\d{8}-\d{6}\.png$/);
    expect(exportFileName('壁紙 10/14', 'png')).toMatch(/^10_14-\d{8}-\d{6}\.png$/);
    expect(exportFileName('壁紙', 'png')).toMatch(/^wallpaper-/);
    expect(exportFileName('x', 'jpeg')).toMatch(/\.jpg$/);
  });
});
