import { buildPyramid } from '../../src/engine/pixels';
import type { EffectOp, EffectParams, EffectType, Level, Shape } from '../../src/engine/types';
import { newOpId } from '../../src/engine/history';

/** テスト用の画像（決定的な模様） */
export function makeLevel(w: number, h: number, fn?: (x: number, y: number) => [number, number, number, number]): Level {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = fn ? fn(x, y) : [(x * 7 + y * 3) % 256, (x * 13) % 256, (y * 11) % 256, 255];
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  return { w, h, f: 1, data };
}

export function pyramid(w: number, h: number, fn?: (x: number, y: number) => [number, number, number, number]) {
  return buildPyramid(makeLevel(w, h, fn), 16);
}

export const P = (over: Partial<EffectParams> = {}): EffectParams => ({ strength: 5, swirlDirection: 'cw', angle: 0, ...over });

export function effect(effect: EffectType, shape: Shape, params: Partial<EffectParams> = {}): EffectOp {
  return { id: newOpId(), kind: 'effect', effect, params: P(params), shape };
}

export function px(data: Uint8ClampedArray, w: number, x: number, y: number) {
  const i = (y * w + x) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
}
