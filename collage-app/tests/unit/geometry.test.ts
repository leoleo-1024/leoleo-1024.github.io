import { describe, expect, it } from 'vitest';
import { applyPinch, coverCrop, layerCorners, panFit, pointInLayer, snapToCenter } from '../../src/model/geometry';
import { makeLayer } from '../../src/model/layout';

describe('coverCrop', () => {
  it('横長画像を縦長枠に入れると左右が切り取られる', () => {
    const { crop } = coverCrop({ width: 4000, height: 3000 }, { width: 100, height: 200 }, { zoom: 1, focusX: 0.5, focusY: 0.5 });
    expect(crop.height).toBeCloseTo(1);
    // 切り抜き範囲の実ピクセル比率が枠と一致する
    expect((crop.width * 4000) / (crop.height * 3000)).toBeCloseTo(0.5);
    expect(crop.x).toBeCloseTo((1 - crop.width) / 2);
  });

  it('同じ比率なら全体が表示される', () => {
    const { crop } = coverCrop({ width: 300, height: 600 }, { width: 100, height: 200 }, { zoom: 1, focusX: 0.5, focusY: 0.5 });
    expect(crop).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it('拡大と表示中心は範囲内に補正される', () => {
    const { crop, fit } = coverCrop({ width: 100, height: 100 }, { width: 100, height: 100 }, { zoom: 2, focusX: 0, focusY: 1 });
    expect(crop.width).toBeCloseTo(0.5);
    expect(crop.x).toBeCloseTo(0);
    expect(crop.y + crop.height).toBeCloseTo(1);
    expect(fit.focusX).toBeCloseTo(0.25);
    expect(fit.zoom).toBe(2);
  });
});

describe('panFit', () => {
  it('右へドラッグすると表示範囲は左へ動く（画像が指についてくる）', () => {
    const layer = { ...makeLayer('l', 'a', { x: 0, y: 0, width: 100, height: 100 }, 0), fit: { zoom: 2, focusX: 0.5, focusY: 0.5 } };
    const asset = { width: 1000, height: 1000 };
    const withCrop = { ...layer, ...coverCrop(asset, layer, layer.fit) };
    const moved = panFit(withCrop, asset, 20, 0);
    // 表示幅 100px に元画像の 50% → 20px は元画像の 10%
    expect(moved.fit.focusX).toBeCloseTo(0.4);
    expect(moved.fit.focusY).toBeCloseTo(0.5);
  });

  it('回転・反転を考慮する', () => {
    const base = { ...makeLayer('l', 'a', { x: 0, y: 0, width: 100, height: 100 }, 0), rotation: 90, fit: { zoom: 2, focusX: 0.5, focusY: 0.5 } };
    const asset = { width: 1000, height: 1000 };
    const layer = { ...base, ...coverCrop(asset, base, base.fit) };
    // 90°回転した画像を下にドラッグ → ローカル座標では右方向
    expect(panFit(layer, asset, 0, 20).fit.focusX).toBeCloseTo(0.4);
    expect(panFit({ ...layer, flipX: true }, asset, 0, 20).fit.focusX).toBeCloseTo(0.6);
  });
});

describe('applyPinch', () => {
  const canvas = { width: 1179, height: 2556 };
  const base = makeLayer('l', 'a', { x: 100, y: 100, width: 200, height: 100 }, 0); // center (200,150)

  it('2倍に広げると中点を基準に拡大される', () => {
    const start = { midX: 200, midY: 150, distance: 100, angle: 0 };
    const r = applyPinch(base, start, { ...start, distance: 200 }, canvas);
    expect(r.width).toBeCloseTo(400);
    expect(r.height).toBeCloseTo(200);
    expect(r.x).toBeCloseTo(200);
    expect(r.y).toBeCloseTo(150);
  });

  it('回転と中点の移動を反映する', () => {
    const start = { midX: 0, midY: 150, distance: 100, angle: 0 };
    const r = applyPinch(base, start, { midX: 10, midY: 160, distance: 100, angle: Math.PI / 2 }, canvas);
    expect(r.rotation).toBeCloseTo(90);
    // 中点 (0,150) から +200 の位置にあった中心が 90°回転 → (10, 160+200)
    expect(r.x).toBeCloseTo(10);
    expect(r.y).toBeCloseTo(360);
  });

  it('極端に小さくならない', () => {
    const start = { midX: 200, midY: 150, distance: 100, angle: 0 };
    const r = applyPinch(base, start, { ...start, distance: 1 }, canvas);
    expect(Math.min(r.width, r.height)).toBeGreaterThanOrEqual(24 - 1e-9);
  });
});

describe('hit test helpers', () => {
  it('回転したレイヤーの内外判定', () => {
    const l = { ...makeLayer('l', 'a', { x: 0, y: 0, width: 200, height: 20 }, 0), rotation: 90 }; // center (100,10)
    expect(pointInLayer(l, 100, 10)).toBe(true);
    expect(pointInLayer(l, 100, 90)).toBe(true); // 縦向きになっている
    expect(pointInLayer(l, 190, 10)).toBe(false);
    expect(layerCorners(l)).toHaveLength(4);
  });

  it('中心線へのスナップ', () => {
    const r = snapToCenter(503, 900, { width: 1000, height: 2000 }, 5);
    expect(r).toEqual({ x: 500, y: 900, snapX: true, snapY: false });
  });
});
