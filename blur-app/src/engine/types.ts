/** 画像処理エンジンの型定義（DOM非依存） */

export type EffectType = 'gaussianBlur' | 'pixelate' | 'blackout' | 'swirl' | 'motionBlur';
export const EFFECT_TYPES: readonly EffectType[] = ['gaussianBlur', 'pixelate', 'blackout', 'swirl', 'motionBlur'];

export type SwirlDirection = 'cw' | 'ccw';

/** 整数の矩形（ピクセル単位） */
export interface IRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 加工範囲の形状。座標はすべて元画像（L0）のピクセル座標（連続座標、画素中心は i+0.5）。
 * brush の points は [x0, y0, x1, y1, ...] の折れ線。radius はブラシ半径。
 */
export type Shape =
  | { type: 'brush'; points: number[]; radius: number }
  | { type: 'rect'; x: number; y: number; w: number; h: number }
  | { type: 'ellipse'; cx: number; cy: number; rx: number; ry: number };

export interface EffectParams {
  /** 効果の強さ 1〜10（黒塗りでは未使用） */
  strength: number;
  /** 渦巻きの回転方向 */
  swirlDirection: SwirlDirection;
  /** モーションブラーの角度（0〜359度、0=水平、90=垂直、画像座標系：Y軸下向き） */
  angle: number;
}

export interface EffectOp {
  id: number;
  kind: 'effect';
  effect: EffectType;
  params: EffectParams;
  shape: Shape;
}

export interface EraseOp {
  id: number;
  kind: 'erase';
  shape: Shape & { type: 'brush' };
}

export type Op = EffectOp | EraseOp;

/** 画像のピラミッドの1段。f は「このレベルの1ピクセル = 元画像の f ピクセル」 */
export interface Level {
  w: number;
  h: number;
  f: number;
  data: Uint8ClampedArray;
}
