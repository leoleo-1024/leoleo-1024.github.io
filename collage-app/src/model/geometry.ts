import type { Crop, Fit, ImageLayer } from './types';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export const DEFAULT_FIT: Fit = { zoom: 1, focusX: 0.5, focusY: 0.5 };
export const MAX_ZOOM = 8;
export const MIN_LAYER_SIZE = 24;

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
export const degToRad = (d: number) => (d * Math.PI) / 180;
export const radToDeg = (r: number) => (r * 180) / Math.PI;

/** 角度を -180〜180 に正規化 */
export function normalizeAngle(deg: number): number {
  let a = deg % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return a;
}

/**
 * 枠（frame）を覆うように画像を切り抜く範囲を求める（object-fit: cover 相当）。
 * fit.zoom で拡大、fit.focus で表示中心を指定する。
 * 戻り値の fit は範囲外にはみ出さないよう補正済み。
 */
export function coverCrop(asset: Size, frame: Size, fit: Fit): { crop: Crop; fit: Fit } {
  const assetAspect = asset.width / asset.height;
  const frameAspect = Math.max(frame.width, 1e-6) / Math.max(frame.height, 1e-6);
  let w = 1;
  let h = 1;
  if (assetAspect > frameAspect) {
    w = frameAspect / assetAspect;
  } else {
    h = assetAspect / frameAspect;
  }
  const zoom = clamp(fit.zoom, 1, MAX_ZOOM);
  w /= zoom;
  h /= zoom;
  const focusX = clamp(fit.focusX, w / 2, 1 - w / 2);
  const focusY = clamp(fit.focusY, h / 2, 1 - h / 2);
  return {
    crop: { x: focusX - w / 2, y: focusY - h / 2, width: w, height: h },
    fit: { zoom, focusX, focusY },
  };
}

/** レイヤーの width/height/fit から crop を再計算する */
export function recomputeCrop(layer: ImageLayer, asset: Size): ImageLayer {
  const { crop, fit } = coverCrop(asset, layer, layer.fit);
  return { ...layer, crop, fit };
}

/** 長方形の中に、縦横比を保って収まるサイズ（contain） */
export function containSize(aspect: number, box: Size, scale = 1): Size {
  let width = box.width;
  let height = width / aspect;
  if (height > box.height) {
    height = box.height;
    width = height * aspect;
  }
  return { width: width * scale, height: height * scale };
}

/**
 * キャンバス座標での移動量を、レイヤー内部の表示範囲（focus）の移動に変換する。
 * 画像を指でなぞった方向に中身が動くようにする（＝ focus は逆方向へ動く）。
 */
export function panFit(layer: ImageLayer, asset: Size, dx: number, dy: number): ImageLayer {
  const r = -degToRad(layer.rotation);
  let lx = dx * Math.cos(r) - dy * Math.sin(r);
  let ly = dx * Math.sin(r) + dy * Math.cos(r);
  if (layer.flipX) lx = -lx;
  if (layer.flipY) ly = -ly;
  const fit: Fit = {
    ...layer.fit,
    focusX: layer.fit.focusX - (lx * layer.crop.width) / Math.max(layer.width, 1e-6),
    focusY: layer.fit.focusY - (ly * layer.crop.height) / Math.max(layer.height, 1e-6),
  };
  return recomputeCrop({ ...layer, fit }, asset);
}

export function zoomFit(layer: ImageLayer, asset: Size, zoom: number): ImageLayer {
  return recomputeCrop({ ...layer, fit: { ...layer.fit, zoom: clamp(zoom, 1, MAX_ZOOM) } }, asset);
}

export interface PinchStart {
  /** 2 本指の中点（キャンバス座標） */
  midX: number;
  midY: number;
  distance: number;
  angle: number; // ラジアン
}

/**
 * 2 本指のピンチ・回転・移動をレイヤーに適用する（フリーモード）。
 * 指の中点を基準に拡大・回転し、中点の移動に合わせて平行移動する。
 */
export function applyPinch(
  base: ImageLayer,
  start: PinchStart,
  now: PinchStart,
  canvas: Size,
): ImageLayer {
  const minScale = MIN_LAYER_SIZE / Math.min(base.width, base.height);
  const maxScale = (Math.max(canvas.width, canvas.height) * 4) / Math.max(base.width, base.height);
  const s = clamp(now.distance / Math.max(start.distance, 1e-6), minScale, maxScale);
  const da = now.angle - start.angle;
  const ox = base.x - start.midX;
  const oy = base.y - start.midY;
  const cos = Math.cos(da);
  const sin = Math.sin(da);
  return {
    ...base,
    x: now.midX + s * (ox * cos - oy * sin),
    y: now.midY + s * (ox * sin + oy * cos),
    width: base.width * s,
    height: base.height * s,
    rotation: normalizeAngle(base.rotation + radToDeg(da)),
  };
}

/** 回転を考慮したレイヤーの 4 隅（キャンバス座標） */
export function layerCorners(layer: Pick<ImageLayer, 'x' | 'y' | 'width' | 'height' | 'rotation'>) {
  const r = degToRad(layer.rotation);
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const hw = layer.width / 2;
  const hh = layer.height / 2;
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([px, py]) => ({ x: layer.x + px * cos - py * sin, y: layer.y + px * sin + py * cos }));
}

/** 点がレイヤー（回転込み）の内側にあるか */
export function pointInLayer(layer: ImageLayer, px: number, py: number): boolean {
  const r = -degToRad(layer.rotation);
  const dx = px - layer.x;
  const dy = py - layer.y;
  const lx = dx * Math.cos(r) - dy * Math.sin(r);
  const ly = dx * Math.sin(r) + dy * Math.cos(r);
  return Math.abs(lx) <= layer.width / 2 && Math.abs(ly) <= layer.height / 2;
}

/** 移動中のレイヤーをキャンバスの中心線にスナップする */
export function snapToCenter(
  x: number,
  y: number,
  canvas: Size,
  threshold: number,
): { x: number; y: number; snapX: boolean; snapY: boolean } {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const snapX = Math.abs(x - cx) < threshold;
  const snapY = Math.abs(y - cy) < threshold;
  return { x: snapX ? cx : x, y: snapY ? cy : y, snapX, snapY };
}
