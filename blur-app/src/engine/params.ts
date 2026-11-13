/**
 * 「強さ 1〜10」から、元画像（L0）のピクセル単位の処理パラメーターへの変換。
 * 画像の長辺 D に比例させているため、解像度が違う画像でも見た目の強さがそろい、
 * プレビュー（縮小画像）と書き出し（元解像度）でも同じ見た目になる。
 */
import type { EffectOp, EffectType, Shape } from './types';

export const STRENGTH_MIN = 1;
export const STRENGTH_MAX = 10;
export const DEFAULT_STRENGTH = 5;

function s(strength: number): number {
  return Math.min(STRENGTH_MAX, Math.max(STRENGTH_MIN, Math.round(strength)));
}

/** ガウスぼかしの標準偏差（元画像px）。4032px の写真で 強さ1≒5px、5≒40px、10≒85px */
export function gaussianSigma(strength: number, D: number): number {
  return D * (0.0012 + 0.0019 * (s(strength) - 1));
}

/** モザイクのブロック1辺（元画像px）。4032px で 強さ1≒16px、5≒68px、10≒132px */
export function pixelBlockSize(strength: number, D: number): number {
  return Math.max(2, D * (0.004 + 0.0028 * (s(strength) - 1)));
}

/** モーションブラーの距離（元画像px、全長）。4032px で 強さ1≒28px、5≒141px、10≒282px */
export function motionLength(strength: number, D: number): number {
  return D * 0.007 * s(strength);
}

/** 渦巻きの中心付近の最大回転角（ラジアン）。強さ1=40°、5=200°、10=400° */
export function swirlMaxAngle(strength: number): number {
  return (s(strength) * 40 * Math.PI) / 180;
}

/** ブラシ時の渦巻きの打点間隔（ブラシ半径に対する比） */
export const SWIRL_DAB_SPACING = 1.0;
/** なぞったときの打点1つあたりの回転角（最大回転角に対する比） */
export const SWIRL_DRAG_ANGLE = 0.8;

/**
 * マスク境界のぼかし幅（元画像px）。0 のときはアンチエイリアス（1レベルpx）のみ。
 * 黒塗りは境界に元画素が透けないよう二値マスクを使う（mask.ts 側で処理）。
 */
export function featherFor(effect: EffectType | 'erase', shape: Shape): number {
  if (shape.type !== 'brush') return 0;
  const r = shape.radius;
  switch (effect) {
    case 'gaussianBlur':
    case 'motionBlur':
      return r * 0.35;
    case 'erase':
      return r * 0.15;
    default:
      return 0;
  }
}

export function isBinaryMask(op: { kind: string; effect?: EffectType }): boolean {
  return op.kind === 'effect' && op.effect === 'blackout';
}

/** 効果の内容（形状に依存しない部分）を表すキー。同じキーの効果はキャッシュを共有できる */
export function globalEffectKey(op: EffectOp, D: number): string | null {
  const p = op.params;
  switch (op.effect) {
    case 'gaussianBlur':
      return `g${gaussianSigma(p.strength, D).toFixed(3)}`;
    case 'pixelate':
      return `p${pixelBlockSize(p.strength, D).toFixed(3)}`;
    case 'motionBlur':
      return `m${motionLength(p.strength, D).toFixed(3)}a${((p.angle % 180) + 180) % 180}`;
    default:
      return null;
  }
}
