import { describe, expect, it } from 'vitest';
import { Renderer } from '../../src/engine/renderer';
import { brushDabs, brushSwirlInverse } from '../../src/engine/effects/swirl';
import { effect, pyramid } from './helpers';

describe('brush swirl', () => {
  it('deforms pixels along the stroke and keeps the outside unchanged', () => {
    const r = new Renderer(pyramid(300, 200, (x, y) => [x % 256, y % 256, ((x >> 3) + (y >> 3)) % 2 ? 255 : 0, 255]));
    const op = effect('swirl', { type: 'brush', points: [50, 100, 150, 100, 250, 100], radius: 20 });
    const d = brushDabs(op);
    expect(d.xs.length).toBeGreaterThan(10);
    const [sx, sy] = brushSwirlInverse(d, 150, 110);
    expect(Math.hypot(sx - 150, sy - 110)).toBeGreaterThan(1);
    const out = r.render([op], 0, { x: 0, y: 0, w: 300, h: 200 });
    let changed = 0;
    for (let x = 50; x < 250; x++) {
      const i = (100 * 300 + x) * 4;
      const j = (95 * 300 + x) * 4;
      if (out[i] !== x % 256 || out[i + 1] !== 100) changed++;
      if (out[j] !== x % 256 || out[j + 1] !== 95) changed++;
    }
    expect(changed).toBeGreaterThan(150);
    const k = (150 * 300 + 150) * 4;
    expect([out[k], out[k + 1]]).toEqual([150, 150]);
  });
});

describe('swirl after a blackout (base image version)', () => {
  it('still deforms', () => {
    const r = new Renderer(pyramid(300, 200, (x, y) => [x % 256, y % 256, ((x >> 3) + (y >> 3)) % 2 ? 255 : 0, 255]));
    const black = effect('blackout', { type: 'rect', x: 0, y: 0, w: 20, h: 20 });
    for (const shape of [
      { type: 'brush' as const, points: [50, 100, 250, 100], radius: 20 },
      { type: 'ellipse' as const, cx: 150, cy: 100, rx: 60, ry: 40 },
    ]) {
      const sw = effect('swirl', shape);
      const a = r.render([sw], 0, { x: 0, y: 0, w: 300, h: 200 });
      const b = r.render([black, sw], 0, { x: 0, y: 0, w: 300, h: 200 });
      let diff = 0;
      for (let y = 30; y < 200; y++) for (let x = 0; x < 300; x++) diff += Math.abs(a[(y * 300 + x) * 4] - b[(y * 300 + x) * 4]);
      expect(diff, shape.type).toBe(0);
    }
  });
});
